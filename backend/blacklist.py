from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import get_db, fetch_all, fetch_one
from typing import List

router = APIRouter()

class BlacklistCreate(BaseModel):
    username: str
    reason: str = None

@router.post("/add")
async def add_to_blacklist(item: BlacklistCreate):
    async with get_db() as db:
        try:
            await db.execute(
                "INSERT INTO blacklist (username, reason) VALUES (?, ?)",
                (item.username, item.reason)
            )
            await db.commit()
        except Exception:
            raise HTTPException(status_code=400, detail="User already in blacklist")
    return {"status": "added"}

@router.get("/list")
async def list_blacklist():
    rows = await fetch_all("SELECT * FROM blacklist ORDER BY id DESC")
    return {"items": [dict(row) for row in rows]}

@router.delete("/remove/{username}")
async def remove_from_blacklist(username: str):
    async with get_db() as db:
        await db.execute("DELETE FROM blacklist WHERE username = ?", (username,))
        await db.commit()
    return {"status": "removed"}
