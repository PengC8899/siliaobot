from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import fetch_all, execute, now_iso

router = APIRouter()

class ApiKeyCreate(BaseModel):
    lines: str # format: api_id:api_hash per line

class BatchIds(BaseModel):
    ids: list[int]

@router.get("")
async def list_keys():
    rows = await fetch_all("SELECT * FROM api_keys ORDER BY id DESC")
    return {"items": rows}

@router.post("/add")
async def add_keys(payload: ApiKeyCreate):
    lines = payload.lines.split("\n")
    count = 0
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            # Try splitting by various separators
            if ":" in line:
                parts = line.split(":")
            elif "|" in line:
                parts = line.split("|")
            elif "," in line:
                parts = line.split(",")
            else:
                parts = line.split()
            
            if len(parts) >= 2:
                api_id = int(parts[0].strip())
                api_hash = parts[1].strip()
                
                # Check if exists
                exists = await fetch_all("SELECT id FROM api_keys WHERE api_id = ?", (api_id,))
                if not exists:
                    await execute(
                        "INSERT INTO api_keys (api_id, api_hash, created_at) VALUES (?, ?, ?)",
                        (api_id, api_hash, now_iso())
                    )
                    count += 1
        except:
            continue
            
    return {"status": "success", "added": count}

@router.delete("/{id}")
async def delete_key(id: int):
    await execute("DELETE FROM api_keys WHERE id = ?", (id,))
    return {"status": "deleted"}

@router.post("/batch_check")
async def batch_check_keys(payload: BatchIds):
    ids = payload.ids
    results = []
    
    # Fetch valid session ONCE to avoid repeated DB calls
    session_rows = await fetch_all("SELECT * FROM sessions WHERE status = 'active' AND session_string IS NOT NULL LIMIT 1")
    if not session_rows:
        session_rows = await fetch_all("SELECT * FROM sessions WHERE status = 'active' LIMIT 1")
    
    if not session_rows:
        return {"results": [{"id": i, "status": "error", "error": "需要至少一个活跃账号"} for i in ids]}
        
    test_session = session_rows[0]
    
    # To avoid circular import or complexity, we just call the logic directly or helper
    # But check_key is an endpoint handler, calling it directly works if we don't rely on Request object
    # check_key uses fetch_all inside, so it's fine.
    
    # Optimization: Call check_key directly
    for kid in ids:
        try:
            res = await check_key(kid)
            results.append({"id": kid, "status": res["status"], "error": res.get("error")})
        except Exception as e:
            results.append({"id": kid, "status": "error", "error": str(e)})
            
    return {"results": results}

@router.post("/check/{id}")
async def check_key(id: int):
    from telethon import TelegramClient, errors
    from telethon.sessions import StringSession
    import os
    from database import SESSION_DIR
    
    # 1. Get the Key
    key_rows = await fetch_all("SELECT * FROM api_keys WHERE id = ?", (id,))
    if not key_rows:
        raise HTTPException(status_code=404, detail="API Key not found")
    
    key = key_rows[0]
    api_id = key["api_id"]
    api_hash = key["api_hash"]
    
    # 2. Get a valid session to use as a "Test Runner"
    # Prefer session string over file to avoid file lock issues
    session_rows = await fetch_all("SELECT * FROM sessions WHERE status = 'active' AND session_string IS NOT NULL LIMIT 1")
    if not session_rows:
         # Fallback to file based session
         session_rows = await fetch_all("SELECT * FROM sessions WHERE status = 'active' LIMIT 1")
    
    if not session_rows:
         return {"status": "error", "error": "需要至少一个活跃账号来检测 API Key"}
    
    session = session_rows[0]
    
    client = None
    status = "valid"
    error_msg = None
    
    try:
        # Construct client with the API Key we want to test
        if session.get("session_string"):
            client = TelegramClient(
                StringSession(session["session_string"]),
                api_id,
                api_hash
            )
        else:
            session_path = os.path.join(SESSION_DIR, session["session_file"])
            client = TelegramClient(
                session_path,
                api_id,
                api_hash
            )
        
        await client.connect()
        
        # If we can connect and authorization is valid, then API Key is valid.
        if not await client.is_user_authorized():
            # Session invalid, but maybe API Key is fine?
            # But usually ApiIdInvalidError raises during connect or first call.
            status = "unknown" 
            error_msg = "测试用账号失效，无法验证"
        else:
             # Make a simple API call
             me = await client.get_me()
             status = "valid"
             error_msg = "正常"

    except (errors.ApiIdInvalidError, errors.ApiIdPublishedFloodError) as e:
        status = "invalid"
        error_msg = f"无效: {str(e)}"
    except Exception as e:
        status = "error"
        error_msg = f"错误: {str(e)}"
    finally:
        if client:
            await client.disconnect()
            
    # Update DB
    new_desc = f"[{status.upper()}] {error_msg}"
    await execute("UPDATE api_keys SET description = ? WHERE id = ?", (new_desc, id))
    
    return {"status": status, "error": error_msg}
