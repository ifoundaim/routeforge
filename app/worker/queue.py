import asyncio
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional


TaskFunc = Callable[[Any], Any]


@dataclass
class TaskRecord:
    id: str
    kind: str
    created_at: float
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    status: str = "queued"  # queued | running | done | error
    error: Optional[str] = None


class InProcessQueue:
    """Tiny in-process async task queue.

    - Single consumer worker running in a background thread + event loop
    - Non-blocking `submit` that returns a task id
    - `status(task_id)` to poll state
    """

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._queue: "asyncio.Queue[tuple[str, TaskFunc, Any]]" = asyncio.Queue(loop=self._loop)  # type: ignore[call-arg]
        self._tasks: Dict[str, TaskRecord] = {}

        self._worker = threading.Thread(target=self._run_loop, daemon=True)
        self._worker.start()

        # configurable backpressure size
        self.max_queue_size = int(os.getenv("WORKER_MAX_QUEUE", "256") or "256")

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.create_task(self._consumer())
        self._loop.run_forever()

    async def _consumer(self) -> None:
        while True:
            task_id, func, arg = await self._queue.get()
            record = self._tasks.get(task_id)
            if record is None:
                continue
            record.status = "running"
            record.started_at = time.time()
            try:
                result = func(arg)
                # functions may be async or sync
                if asyncio.iscoroutine(result):
                    await result
                record.status = "done"
                record.finished_at = time.time()
            except Exception as exc:
                record.status = "error"
                record.error = str(exc)
                record.finished_at = time.time()
            finally:
                self._queue.task_done()

    def submit(self, task_id: str, kind: str, func: TaskFunc, arg: Any) -> bool:
        if self._queue.qsize() >= self.max_queue_size:
            return False
        self._tasks[task_id] = TaskRecord(id=task_id, kind=kind, created_at=time.time())
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (task_id, func, arg))
        return True

    def status(self, task_id: str) -> Optional[TaskRecord]:
        return self._tasks.get(task_id)


queue = InProcessQueue()

__all__ = ["queue", "InProcessQueue", "TaskRecord"]


