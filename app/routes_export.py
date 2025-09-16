import csv
import io
import logging
from typing import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .errors import json_error
from . import models


logger = logging.getLogger("routeforge.export")

router = APIRouter(prefix="/api", tags=["routes-export"])


def error(code: str, status_code: int = 400):
    return json_error(code, status_code=status_code)


def _normalize_limit(raw_limit: int) -> int:
    try:
        limit = int(raw_limit)
    except Exception:
        limit = 1000
    if limit < 1:
        limit = 1
    if limit > 10000:
        limit = 10000
    return limit


@router.get("/routes/{route_id}/export.csv")
def export_route_hits(route_id: int, limit: int = 1000, db: Session = Depends(get_db)):
    route = db.get(models.Route, route_id)
    if route is None:
        return error("not_found", status_code=404)

    normalized_limit = _normalize_limit(limit)

    query = (
        select(
            models.RouteHit.ts.label("ts"),
            models.RouteHit.ip.label("ip"),
            models.RouteHit.ua.label("ua"),
            models.RouteHit.ref.label("ref"),
        )
        .where(models.RouteHit.route_id == route_id)
        .order_by(models.RouteHit.ts.desc())
        .limit(normalized_limit)
    )

    def row_to_csv() -> Iterator[str]:
        yield "ts,ip,ua,ref\n"
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        for row in db.execute(query):
            buffer.seek(0)
            buffer.truncate(0)
            if row.ts is None:
                ts_value = ""
            elif hasattr(row.ts, 'isoformat'):
                ts_value = row.ts.isoformat()
            else:
                ts_value = str(row.ts)
            writer.writerow(
                [
                    ts_value,
                    row.ip or "",
                    row.ua or "",
                    row.ref or "",
                ]
            )
            yield buffer.getvalue()

    filename = f"route-{route.slug}-hits.csv"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }

    return StreamingResponse(
        row_to_csv(),
        media_type="text/csv",
        headers=headers,
    )
