from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db, fetch_all
import python_socks
from urllib.parse import urlparse

router = APIRouter()

class ProxyAdd(BaseModel):
    urls: list[str]  # List of proxy URLs

@router.post("/add")
async def add_proxies(item: ProxyAdd):
    async with get_db() as db:
        count = 0
        for url in item.urls:
            try:
                # Basic validation
                parsed = urlparse(url)
                if not parsed.scheme or not parsed.netloc:
                    continue
                
                await db.execute(
                    "INSERT INTO proxies (url, status, fail_count, last_used) VALUES (?, 'active', 0, NULL)",
                    (url,)
                )
                count += 1
            except Exception:
                pass # Skip duplicates
        await db.commit()
    return {"added": count}

@router.get("/list")
async def list_proxies():
    rows = await fetch_all("SELECT * FROM proxies ORDER BY id DESC")
    return {"items": [dict(row) for row in rows]}

@router.delete("/remove/{proxy_id}")
async def remove_proxy(proxy_id: int):
    async with get_db() as db:
        await db.execute("DELETE FROM proxies WHERE id = ?", (proxy_id,))
        await db.commit()
    return {"status": "removed"}
