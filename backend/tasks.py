import asyncio
from fastapi import APIRouter
from pydantic import BaseModel, Field
from database import execute_returning_id, fetch_all, now_iso, serialize_targets, get_db, execute
from worker import run_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreateRequest(BaseModel):
    message: str
    targets: list[str] = Field(default_factory=list)
    delay_seconds: int = 20
    random_delay: bool = False
    max_per_account: int = 40


@router.post("/create")
async def create_task(payload: TaskCreateRequest):
    # De-duplicate targets
    unique_targets = list(dict.fromkeys(payload.targets))
    
    task_id = await execute_returning_id(
        """
        INSERT INTO tasks (
            message, targets, delay_seconds, random_delay, max_per_account, 
            status, total_count, success_count, fail_count, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.message,
            serialize_targets(unique_targets),
            payload.delay_seconds,
            1 if payload.random_delay else 0,
            payload.max_per_account,
            "queued",
            len(unique_targets),
            0,
            0,
            now_iso(),
        ),
    )
    asyncio.create_task(run_task(task_id))
    
    # Bulk insert into task_targets
    async with get_db() as db:
        for target in unique_targets:
            await db.execute(
                "INSERT INTO task_targets (task_id, target, status) VALUES (?, ?, ?)",
                (task_id, target, "pending")
            )
        await db.commit()

    return {"task_id": task_id, "total_targets": len(unique_targets)}


@router.get("/{task_id}/targets")
async def get_task_targets(task_id: int):
    rows = await fetch_all(
        """
        SELECT tt.*, s.phone as sender_phone 
        FROM task_targets tt
        LEFT JOIN sessions s ON tt.worker_session_id = s.id
        WHERE tt.task_id = ?
        ORDER BY tt.id ASC
        """, 
        (task_id,)
    )
    return {"items": rows}


@router.post("/{task_id}/stop")
async def stop_task(task_id: int):
    await execute("UPDATE tasks SET status = 'stopped' WHERE id = ? AND status = 'running'", (task_id,))
    return {"status": "stopped"}


@router.delete("/{task_id}")
async def delete_task(task_id: int):
    # Clean up everything related to this task
    await execute("DELETE FROM task_targets WHERE task_id = ?", (task_id,))
    await execute("DELETE FROM logs WHERE task_id = ?", (task_id,))
    await execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return {"status": "deleted"}


@router.get("")
async def list_tasks():
    rows = await fetch_all("SELECT * FROM tasks ORDER BY id DESC")
    return {"items": rows}
