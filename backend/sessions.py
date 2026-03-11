import os
import zipfile
from io import BytesIO
from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Body
from telethon import TelegramClient
from telethon.sessions import StringSession
from database import SESSION_DIR, execute, fetch_all, fetch_one, now_iso, get_db
from pydantic import BaseModel
import re

router = APIRouter(prefix="/sessions", tags=["sessions"])

class BatchIds(BaseModel):
    ids: list[int]


@router.post("/upload")
async def upload_sessions(
    files: list[UploadFile] = File(...),
    api_id: str = Form(...),
    api_hash: str = Form(...),
):
    saved = []
    # Ensure id is int
    try:
        api_id_int = int(api_id)
    except:
        api_id_int = 0
    for file in files:
        content = await file.read()
        if file.filename.endswith(".zip"):
            with zipfile.ZipFile(BytesIO(content)) as archive:
                for info in archive.infolist():
                    if not info.filename.endswith(".session"):
                        continue
                    session_name = os.path.basename(info.filename)
                    session_path = os.path.join(SESSION_DIR, session_name)
                    with archive.open(info) as source, open(session_path, "wb") as target:
                        target.write(source.read())
                    saved.append(session_name)
        elif file.filename.endswith(".session"):
            session_name = os.path.basename(file.filename)
            session_path = os.path.join(SESSION_DIR, session_name)
            with open(session_path, "wb") as target:
                target.write(content)
            saved.append(session_name)
    
    for session_name in saved:
        # Try to guess phone number from filename
        phone_value = os.path.splitext(session_name)[0]
        # Basic cleanup if filename contains extra info
        if "_" in phone_value:
             phone_value = phone_value.split("_")[-1] 
        
        await execute(
            """
            INSERT INTO sessions (phone, api_id, api_hash, session_file, status, last_used, flood_wait)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (phone_value, api_id_int, api_hash, session_name, "active", None, None),
        )
    return {"status": "uploaded", "count": len(saved)}


@router.get("")
async def list_sessions():
    rows = await fetch_all("SELECT * FROM sessions ORDER BY id DESC")
    return {"items": rows}


@router.get("/{session_id}/otp")
async def get_session_otp(session_id: int):
    session_row = await fetch_one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")
        
    client = TelegramClient(
        StringSession(session_row["session_string"]) if session_row["session_string"] else os.path.join(SESSION_DIR, session_row["session_file"]),
        session_row["api_id"],
        session_row["api_hash"]
    )
    
    try:
        await client.connect()
        if not await client.is_user_authorized():
             return {"status": "error", "message": "Session invalid or not authorized"}
        
        # Get messages from Telegram Service Notifications (777000)
        messages = await client.get_messages(777000, limit=1)
        
        if not messages:
             return {"status": "error", "message": "No messages found from Telegram (777000)"}

        latest_msg = messages[0]
        text = latest_msg.message or ""
        
        # Regex for code: usually 5 digits, sometimes with dashes
        match = re.search(r'\b(\d{5})\b', text)
        code = match.group(1) if match else None
        
        return {
            "status": "success",
            "code": code,
            "full_message": text,
            "date": latest_msg.date.isoformat() if latest_msg.date else None
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        await client.disconnect()

@router.post("/check/{session_id}")
async def check_session_health(session_id: int):
    session_row = await fetch_one("SELECT * FROM sessions WHERE id = ?", (session_id,))
    
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    client = TelegramClient(
        StringSession(session_row["session_string"]) if session_row["session_string"] else os.path.join(SESSION_DIR, session_row["session_file"]),
        session_row["api_id"],
        session_row["api_hash"]
    )

    status = "active"
    health_score = session_row["health_score"] if session_row["health_score"] is not None else 100
    nickname = session_row["nickname"]
    
    try:
        await client.connect()
        if not await client.is_user_authorized():
            status = "invalid"
            health_score = 0
        else:
            me = await client.get_me()
            # Handle case where first_name or last_name might be None
            first = me.first_name or ""
            last = me.last_name or ""
            nickname = f"{first} {last}".strip()
            # simple check if restricted
            if me.restricted:
                status = "banned"
                health_score = 0
            else:
                # Basic health check passed
                health_score = min(100, health_score + 5) # recover score
    except Exception as e:
        status = "invalid"
        health_score = max(0, health_score - 20)
        print(f"Health check error: {e}")
    finally:
        await client.disconnect()

    await execute(
        "UPDATE sessions SET status = ?, health_score = ?, nickname = ? WHERE id = ?", 
        (status, health_score, nickname, session_id)
    )

    return {"status": status, "id": session_id, "health_score": health_score, "nickname": nickname}


@router.post("/batch_check")
async def batch_check_sessions(payload: BatchIds):
    ids = payload.ids
    results = []
    for sid in ids:
        try:
            res = await check_session_health(sid)
            results.append(res)
        except Exception as e:
            print(f"Error checking session {sid}: {e}")
            results.append({"id": sid, "status": "error", "error": str(e)})
    return {"results": results}


@router.post("/batch_delete")
async def batch_delete_sessions(payload: BatchIds):
    ids = payload.ids
    async with get_db() as db:
        for sid in ids:
            await db.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        await db.commit()
    return {"status": "deleted", "count": len(ids)}


@router.post("/update_profile")
async def update_profile(
    ids: list[str] = Form(...), # List of session IDs (comma separated string if using FormData)
    first_name: str = Form(None),
    about: str = Form(None),
    avatar: UploadFile = File(None)
):
    # Parse ids from comma separated string
    session_ids = []
    if ids and isinstance(ids[0], str):
        try:
            session_ids = [int(x) for x in ids[0].split(",")]
        except:
            pass
            
    if not session_ids:
        return {"status": "error", "message": "No IDs provided"}

    print(f"Updating profile for {len(session_ids)} sessions. first_name={first_name}, about={about}, avatar={avatar}")

    from telethon.tl.functions.account import UpdateProfileRequest
    from telethon.tl.functions.photos import UploadProfilePhotoRequest
    
    success_count = 0
    
    # Save avatar temporarily if provided
    avatar_path = None
    if avatar:
        avatar_path = f"/tmp/{avatar.filename}"
        with open(avatar_path, "wb") as f:
            f.write(await avatar.read())

    for sid in session_ids:
        try:
            session_row = await fetch_one("SELECT * FROM sessions WHERE id = ?", (sid,))
            
            if not session_row: continue

            client = TelegramClient(
                StringSession(session_row["session_string"]) if session_row.get("session_string") else os.path.join(SESSION_DIR, session_row["session_file"]),
                session_row["api_id"],
                session_row["api_hash"]
            )
            
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                continue
                
            # Update text info
            if first_name or about:
                await client(UpdateProfileRequest(
                    first_name=first_name if first_name else None,
                    about=about if about else None
                ))
                
            # Update avatar
            if avatar_path:
                await client(UploadProfilePhotoRequest(
                    file=await client.upload_file(avatar_path)
                ))
                
            # Update local DB nickname
            if first_name:
                print(f"Updating local DB nickname for {sid} to {first_name}")
                await execute("UPDATE sessions SET nickname = ? WHERE id = ?", (first_name, sid))
            else:
                # If nickname wasn't provided, try to fetch it from Telegram
                try:
                    me = await client.get_me()
                    # Handle case where first_name or last_name might be None
                    first = me.first_name or ""
                    last = me.last_name or ""
                    new_nickname = f"{first} {last}".strip()
                    print(f"Fetched nickname for {sid}: {new_nickname}")
                    await execute("UPDATE sessions SET nickname = ? WHERE id = ?", (new_nickname, sid))
                except Exception as e:
                    print(f"Failed to fetch nickname for {sid}: {e}")

            success_count += 1
            await client.disconnect()
        except Exception as e:
            print(f"Update profile failed for {sid}: {e}")
            
    if avatar_path and os.path.exists(avatar_path):
        os.remove(avatar_path)
        
    return {"status": "success", "count": success_count}
