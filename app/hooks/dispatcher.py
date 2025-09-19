import hmac
import json
import logging
import threading
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import try_get_session
from ..models import Webhook


logger = logging.getLogger("routeforge.webhooks")


@dataclass
class WebhookJob:
    id: int
    url: str
    secret: str
    event: str
    payload: Dict[str, Any]


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, sha256).hexdigest()


def _deliver(job: WebhookJob) -> bool:
    body = json.dumps(job.payload).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "X-RF-Webhook-Event": job.event,
        "X-RF-Webhook-Sign": _sign(job.secret, body),
    }
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            resp = client.post(job.url, content=body, headers=headers)
            return 200 <= resp.status_code < 300
    except Exception as exc:
        logger.warning("Webhook delivery failed url=%s err=%s", job.url, exc)
        return False


def _run_job(job: WebhookJob, max_retries: int = 3, backoff: float = 1.0) -> None:
    for attempt in range(max_retries):
        ok = _deliver(job)
        if ok:
            return
        time.sleep(backoff * (2**attempt))
    # persist last_failed_at
    session = try_get_session()
    if session is None:
        return
    try:
        row = session.get(Webhook, job.id)
        if row is not None:
            from sqlalchemy import func as sa_func

            row.last_failed_at = sa_func.now()
            session.add(row)
            session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()


def enqueue_event(user_id: int, event: str, payload: Dict[str, Any]) -> int:
    session = try_get_session()
    if session is None:
        return 0
    try:
        rows = (
            session.execute(
                select(Webhook).where(Webhook.user_id == int(user_id), Webhook.event == event, Webhook.active == 1)
            )
            .scalars()
            .all()
        )
        count = 0
        for row in rows:
            job = WebhookJob(id=row.id, url=row.url, secret=row.secret, event=event, payload=payload)
            t = threading.Thread(target=_run_job, args=(job,), daemon=True)
            t.start()
            count += 1
        return count
    finally:
        session.close()


