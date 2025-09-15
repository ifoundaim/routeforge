import os
import logging
from typing import Generator, Optional, Any
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker, Session


# Load environment variables from .env if present
load_dotenv()

logger = logging.getLogger("routeforge.db")


def get_engine(dsn: Optional[str] = None):
    """
    Create a synchronous SQLAlchemy engine from the given DSN or TIDB_DSN env var.
    """
    effective_dsn = dsn or os.getenv("TIDB_DSN")
    if not effective_dsn:
        raise RuntimeError(
            "TIDB_DSN is not set. Define it in your environment or .env file."
        )
    engine = create_engine(
        effective_dsn,
        pool_pre_ping=True,
        pool_recycle=3600,
        future=True,
    )
    return engine


# Create the global engine and session factory for the app
_engine = None
_SessionLocal = None


def _ensure_engine_and_session():
    global _engine, _SessionLocal
    if _engine is None:
        _engine = get_engine()
    if _SessionLocal is None:
        _SessionLocal = scoped_session(
            sessionmaker(bind=_engine, autocommit=False, autoflush=False)
        )


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that provides a DB session and ensures proper cleanup."""
    _ensure_engine_and_session()
    db: Session = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception as exc:  # pragma: no cover - simple safety
        db.rollback()
        logger.exception("DB session rolled back due to exception: %s", exc)
        raise
    finally:
        db.close()


def try_get_session() -> Optional[Session]:
    """Best-effort session opener. Returns None if engine is unavailable (e.g., no DSN).

    Allows routes to degrade gracefully in demo environments without a database.
    """
    try:
        _ensure_engine_and_session()
    except Exception as exc:  # pragma: no cover - demo convenience
        logger.warning("DB unavailable: %s", exc)
        return None
    try:
        return _SessionLocal()
    except Exception as exc:  # pragma: no cover - demo convenience
        logger.warning("Failed to create DB session: %s", exc)
        return None


def execute_scalar(sql: str, **params: Any) -> Any:
    """Execute a SQL statement and return the first scalar value.

    Uses the global engine and a short-lived connection. Intended for metadata checks
    and administrative operations.
    """
    _ensure_engine_and_session()
    with _engine.connect() as conn:
        result = conn.execute(
            conn.exec_driver_sql(sql),
        ) if not params else conn.execute(conn.exec_driver_sql(sql), params)
        row = result.fetchone()
        return row[0] if row is not None and len(row) > 0 else None


def now_utc() -> datetime:
    """Return a timezone-aware UTC datetime (for consistency in logs)."""
    return datetime.now(timezone.utc)

