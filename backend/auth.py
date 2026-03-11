import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from telethon import TelegramClient
from database import SESSION_DIR, execute, fetch_one, now_iso

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    phone: str
    code: str
    phone_code_hash: str
    api_id: int = 35019294
    api_hash: str = "9e2d91fe6876d834bae4707b0875e2d7"

class SendCodeRequest(BaseModel):
    phone: str
    api_id: int = 35019294
    api_hash: str = "9e2d91fe6876d834bae4707b0875e2d7"

@router.post("/send_code")
async def send_code(req: SendCodeRequest):
    client = TelegramClient(StringSession(), req.api_id, req.api_hash)
    await client.connect()
    
    try:
        sent = await client.send_code_request(req.phone)
        # Store api_id/hash/phone_code_hash temporarily? 
        # For simplicity, return phone_code_hash to client, client sends it back
        return {"phone_code_hash": sent.phone_code_hash}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()

@router.post("/login")
async def login(req: LoginRequest):
    client = TelegramClient(StringSession(), req.api_id, req.api_hash)
    await client.connect()

    try:
        user = await client.sign_in(req.phone, req.code, phone_code_hash=req.phone_code_hash)
        session_string = client.session.save()
        
        async with get_db() as db:
            await db.execute(
                "INSERT INTO sessions (phone, api_id, api_hash, session_string, status) VALUES (?, ?, ?, ?, ?)",
                (req.phone, req.api_id, req.api_hash, session_string, "active")
            )
            await db.commit()
            
        return {"status": "success", "phone": req.phone}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.disconnect()
