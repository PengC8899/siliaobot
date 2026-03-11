import asyncio
import logging
import random
import os
from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from database import get_db, fetch_one, fetch_all, execute, now_iso, deserialize_targets, SESSION_DIR

logger = logging.getLogger(__name__)

# --- Helpers ---

async def log_event(task_id, session_id, target, status, error=None):
    # We need to import log_hub inside or top level
    from logs import log_hub
    await execute(
        """
        INSERT INTO logs (task_id, session_id, target, status, error, time)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (task_id, session_id, target, status, error, now_iso()),
    )
    await log_hub.broadcast(
        {
            "task_id": task_id,
            "session_id": session_id,
            "target": target,
            "status": status,
            "error": error,
            "time": now_iso(),
        },
        task_id=task_id,
    )

async def check_blacklist(target):
    row = await fetch_one("SELECT * FROM blacklist WHERE username = ?", (target,))
    return row is not None

def process_template(template):
    import re
    def replace(match):
        choices = match.group(1).split("|")
        return random.choice(choices)
    return re.sub(r"\{([^{}]+)\}", replace, template)

# --- New Features ---

async def get_active_sessions():
    # Prefer sessions with higher health score
    sessions = await fetch_all("SELECT * FROM sessions WHERE status = 'active' ORDER BY health_score DESC")
    return [dict(s) for s in sessions]

async def update_health_score(session_id, delta):
    # Atomic update not easy with simple execute, need read-update-write or raw sql with math
    # SQLite supports: UPDATE sessions SET health_score = health_score + ?
    # We need to clamp between 0 and 100
    # SQL: UPDATE sessions SET health_score = MAX(0, MIN(100, IFNULL(health_score, 100) + ?))
    await execute(
        "UPDATE sessions SET health_score = MAX(0, MIN(100, IFNULL(health_score, 100) + ?)) WHERE id = ?",
        (delta, session_id)
    )

async def human_like_behavior(client, target):
    """Simulate human behavior: typing, reading, random delays"""
    try:
        # 1. Random delay before action (1-5s)
        await asyncio.sleep(random.uniform(1.0, 5.0))
        
        # 2. Simulate typing
        # Some targets might be channel/group, action might fail if no permission, ignore error
        async with client.action(target, 'typing'):
            # Simulate typing speed
            await asyncio.sleep(random.uniform(2.0, 5.0))
            
    except Exception:
        pass # Ignore errors in simulation

# --- Main Task Logic ---

async def run_task(task_id: int):
    task = await fetch_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if not task:
        return

    await execute("UPDATE tasks SET status = ? WHERE id = ?", ("running", task_id))
    
    # Update total count
    total_count = await fetch_one("SELECT count(*) as cnt FROM task_targets WHERE task_id = ?", (task_id,))
    if total_count and total_count["cnt"] > 0:
        await execute("UPDATE tasks SET total_count = ? WHERE id = ?", (total_count["cnt"], task_id))
    else:
        # Compatibility: check if targets in JSON but not in DB (old tasks)
        try:
            targets_json = deserialize_targets(task["targets"])
            if targets_json and not await fetch_one("SELECT id FROM task_targets WHERE task_id = ?", (task_id,)):
                 # Migration logic for old tasks
                 async with get_db() as db:
                     for t in targets_json:
                         await db.execute("INSERT INTO task_targets (task_id, target, status) VALUES (?, ?, 'pending')", (task_id, t))
                     await db.commit()
                 await execute("UPDATE tasks SET total_count = ? WHERE id = ?", (len(targets_json), task_id))
        except:
            pass

    # Fetch pending targets from DB
    pending_targets = await fetch_all("SELECT * FROM task_targets WHERE task_id = ? AND status = 'pending' ORDER BY id ASC", (task_id,))

    if not pending_targets:
        await execute("UPDATE tasks SET status = ? WHERE id = ?", ("completed", task_id))
        return

    sessions = await get_active_sessions()
    if not sessions:
        await log_event(task_id, None, "system", "failed", "No active sessions")
        await execute("UPDATE tasks SET status = ? WHERE id = ?", ("failed", task_id))
        return

    per_session_counts = {}
    
    # Track target failure counts locally for this run
    # Format: {target: fail_count}
    target_fail_counts = {}
    MAX_TARGET_FAILURES = 10
    
    total_sessions = len(sessions)
    session_idx = 0
    
    base_delay = max(1, int(task["delay_seconds"] or 30))

    for target_row in pending_targets:
        # Check if task is stopped
        current_task_state = await fetch_one("SELECT status FROM tasks WHERE id = ?", (task_id,))
        if not current_task_state or current_task_state["status"] == "stopped":
            break

        target = target_row["target"]
        target_db_id = target_row["id"]
        
        # Check local failure count
        if target_fail_counts.get(target, 0) >= MAX_TARGET_FAILURES:
            await log_event(task_id, None, target, "skipped", f"Skipped after {MAX_TARGET_FAILURES} failures")
            await execute("UPDATE task_targets SET status = 'failed', error = 'Max retry limit reached', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
            await execute("UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?", (task_id,))
            continue

        # Double check status in case of parallel (future proof)
        current_status = await fetch_one("SELECT status FROM task_targets WHERE id = ?", (target_db_id,))
        if current_status and current_status["status"] != "pending":
            continue

        # 1. Check Blacklist
        if await check_blacklist(target):
            await log_event(task_id, None, target, "skipped", "blacklisted")
            await execute("UPDATE task_targets SET status = 'skipped', error = 'blacklisted', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
            continue

        # 2. Try until success or no sessions left
        target_success = False
        sessions_attempted_for_target = set()
        
        while not target_success:
            # Check if task stopped in inner loop
            current_task_state = await fetch_one("SELECT status FROM tasks WHERE id = ?", (task_id,))
            if not current_task_state or current_task_state["status"] == "stopped":
                break

            # Find Available Session
            now_ts = int(asyncio.get_event_loop().time()) 
            selected_session = None
            attempts = 0
            
            # Refresh sessions list if needed? No, let's stick to initial list but respect updates
            # Actually, if we loop too much, we might want to re-fetch sessions, but for now use cached list
            
            start_idx = session_idx
            found_candidate = False
            
            # Try to find a candidate we haven't tried for THIS target yet
            # But we also need to respect global rotation
            
            # Simple approach: Loop through sessions starting from current session_idx
            # If we find one we haven't used for this target and is valid, use it.
            # If we loop through ALL sessions and none are usable/valid, break target loop (fail).
            
            while attempts < total_sessions:
                candidate = sessions[session_idx]
                sid = candidate["id"]
                
                # If already tried for this target, skip
                if sid in sessions_attempted_for_target:
                    session_idx = (session_idx + 1) % total_sessions
                    attempts += 1
                    continue

                # Check local constraints
                if per_session_counts.get(sid, 0) >= task["max_per_account"]:
                    session_idx = (session_idx + 1) % total_sessions
                    attempts += 1
                    continue
                    
                # Check DB status (flood wait)
                fresh_session = await fetch_one("SELECT * FROM sessions WHERE id = ?", (sid,))
                if not fresh_session or fresh_session["status"] != "active":
                    # Remove from local list? Or just skip
                    # Better update local list object
                    sessions[session_idx] = fresh_session if fresh_session else candidate # keep candidate if None (deleted?)
                    if not fresh_session or fresh_session["status"] != "active":
                         session_idx = (session_idx + 1) % total_sessions
                         attempts += 1
                         continue
                    
                # Check flood wait
                fw = fresh_session.get("flood_wait")
                import time
                if fw and fw > time.time():
                    session_idx = (session_idx + 1) % total_sessions
                    attempts += 1
                    continue

                selected_session = fresh_session
                found_candidate = True
                break
            
            if not found_candidate:
                # We tried all sessions or all valid sessions are exhausted for this target
                await log_event(task_id, None, target, "failed", "No more available sessions for this target")
                await execute("UPDATE task_targets SET status = 'failed', error = 'All sessions failed/busy', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
                await execute("UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?", (task_id,))
                break # Break inner loop, move to next target

            # Mark as attempted
            sessions_attempted_for_target.add(selected_session["id"])
            
            # 3. Prepare Client
            client = None
            try:
                # API Key Rotation Strategy:
                # 1. Fetch all available API keys
                # 2. Try to use a random key first
                # 3. If connection fails with "App" related errors, we should mark it and retry with another key?
                # Currently simple random choice.
                
                api_id = selected_session["api_id"]
                api_hash = selected_session["api_hash"]
                
                # Fetch available API keys
                available_api_keys = await fetch_all("SELECT * FROM api_keys")
                if available_api_keys:
                    chosen_key = random.choice(available_api_keys)
                    api_id = chosen_key["api_id"]
                    api_hash = chosen_key["api_hash"]
                
                # logger.info(f"Using API Key: {api_id} for session {selected_session['phone']}")

                if selected_session.get("session_string"):
                    client = TelegramClient(
                        StringSession(selected_session["session_string"]),
                        api_id,
                        api_hash
                    )
                else:
                    session_path = os.path.join(SESSION_DIR, selected_session["session_file"])
                    client = TelegramClient(
                        session_path,
                        api_id,
                        api_hash
                    )
                
                # 4. Connect & Send
                # Note: TelegramClient check api_id/hash when connecting or invoking methods.
                # If api_id is invalid or rate limited, it might raise error here.
                
                await client.connect()
                if not await client.is_user_authorized():
                    await update_health_score(selected_session["id"], -50)
                    await execute("UPDATE sessions SET status = 'invalid' WHERE id = ?", (selected_session["id"],))
                    await client.disconnect()
                    # Don't fail target, just try next session
                    continue 

                # Human Behavior
                await human_like_behavior(client, target)
                
                # Resolve target first if it's a username
                # Telethon sometimes fails to resolve username if not cached.
                # Explicitly getting entity can help.
                try:
                    if isinstance(target, str) and not target.isdigit() and not target.startswith("+"):
                        # It's a username
                        entity = await client.get_entity(target)
                        real_target = entity
                    else:
                        real_target = target
                except ValueError:
                     # "No user has 'xxx' as username" usually raises ValueError in Telethon
                     raise Exception(f"No user has '{target}' as username")
                except Exception as e:
                     raise e

                msg_content = process_template(task["message"])
                await client.send_message(real_target, msg_content)
                
                # Success
                await log_event(task_id, selected_session["id"], target, "success")
                per_session_counts[selected_session["id"]] = per_session_counts.get(selected_session["id"], 0) + 1
                await update_health_score(selected_session["id"], 1)
                await execute("UPDATE tasks SET success_count = success_count + 1 WHERE id = ?", (task_id,))
                await execute(
                    "UPDATE task_targets SET status = 'success', worker_session_id = ?, executed_at = ? WHERE id = ?", 
                    (selected_session["id"], now_iso(), target_db_id)
                )
                
                target_success = True
                # Rotate for next TARGET
                session_idx = (session_idx + 1) % total_sessions

            except errors.FloodWaitError as e:
                # This error is usually Account related, but can be App related if it says "API_ID_PUBLISHED_FLOOD" or similar.
                # Standard FloodWait is for Account.
                wait_time = e.seconds
                await log_event(task_id, selected_session["id"], target, "flood_wait", f"Wait {wait_time}s")
                
                import time
                cooldown_until = int(time.time()) + wait_time
                await execute("UPDATE sessions SET status = 'cooldown', flood_wait = ? WHERE id = ?", (cooldown_until, selected_session["id"]))
                await update_health_score(selected_session["id"], -10)
                # Do NOT fail target, rotate session
                session_idx = (session_idx + 1) % total_sessions
            
            except (errors.ApiIdInvalidError, errors.ApiIdPublishedFloodError) as e:
                # Critical API Key Error
                await log_event(task_id, selected_session["id"], target, "api_error", f"Invalid API Key: {api_id}")
                # We should probably remove this key from rotation or just retry with another one?
                # For now, just retry with next session (which will pick another random key)
                session_idx = (session_idx + 1) % total_sessions

            except errors.UserPrivacyRestrictedError:
                 await log_event(task_id, selected_session["id"], target, "privacy_restricted")
                 await update_health_score(selected_session["id"], -1) 
                 # Fatal for this target
                 await execute("UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?", (task_id,))
                 await execute("UPDATE task_targets SET status = 'failed', error = 'Privacy restricted', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
                 break # Break inner loop
                 
            except errors.RPCError as e:
                await log_event(task_id, selected_session["id"], target, "failed", str(e))
                await update_health_score(selected_session["id"], -5)
                
                # Increment target failure count for RPC errors too (e.g. PeerIdInvalid)
                target_fail_counts[target] = target_fail_counts.get(target, 0) + 1
                if target_fail_counts[target] >= MAX_TARGET_FAILURES:
                    await execute("UPDATE task_targets SET status = 'failed', error = 'Max retry limit reached', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
                    await execute("UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?", (task_id,))
                    break
                
                # Retry with next session
                session_idx = (session_idx + 1) % total_sessions
                
            except Exception as e:
                await log_event(task_id, selected_session["id"], target, "failed", str(e))
                # Increment target failure count
                target_fail_counts[target] = target_fail_counts.get(target, 0) + 1
                
                # Check if we should stop retrying this target
                if target_fail_counts[target] >= MAX_TARGET_FAILURES:
                    await execute("UPDATE task_targets SET status = 'failed', error = 'Max retry limit reached', executed_at = ? WHERE id = ?", (now_iso(), target_db_id))
                    await execute("UPDATE tasks SET fail_count = fail_count + 1 WHERE id = ?", (task_id,))
                    break # Break inner loop
                
                # Retry with next session? Unknown error might be session specific or code specific
                session_idx = (session_idx + 1) % total_sessions
                
            finally:
                if client and client.is_connected():
                    await client.disconnect()

        # End of inner loop (target processing)
        
        # 5. Dynamic Delay between targets (only if we actually sent something or tried)
        if task["random_delay"]:
            delay = random.uniform(base_delay * 0.8, base_delay * 1.5)
        else:
            delay = base_delay
        
        await asyncio.sleep(delay)

    await execute("UPDATE tasks SET status = ? WHERE id = ?", ("completed", task_id))
