"""Helpers for managing RouteForge user accounts."""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models


logger = logging.getLogger("routeforge.auth.accounts")

DEMO_EMAIL = "demo@routeforge.local"
DEMO_NAME = "RouteForge Demo"


def _normalize_email(raw: str) -> str:
    if raw is None:
        raise ValueError("email is required")
    normalized = raw.strip().lower()
    if not normalized:
        raise ValueError("email is required")
    return normalized


def create_user(db: Session, *, email: str, name: Optional[str] = None) -> models.User:
    """Create a new user record.

    Raises a ValueError if the email is empty. If a unique constraint violation occurs,
    the existing user is returned.
    """
    if email is None:
        raise ValueError("email is required")
    email = email.strip().lower()
    normalized = _normalize_email(email)
    user = models.User(email=normalized, name=name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.execute(
            select(models.User).where(models.User.email == normalized)
        ).scalar_one_or_none()
        if existing is None:
            raise
        logger.info("User already existed for email=%s", normalized)
        return existing

    db.refresh(user)
    logger.info("Created user id=%s email=%s", user.id, user.email)
    return user


def get_or_create_user_by_email(
    db: Session, *, email: str, name: Optional[str] = None
) -> models.User:
    """Look up a user by email, creating a new record if needed."""
    if email is None:
        raise ValueError("email is required")
    email = email.strip().lower()
    normalized = _normalize_email(email)
    existing = db.execute(select(models.User).where(models.User.email == normalized)).scalar_one_or_none()
    if existing is not None:
        return existing

    return create_user(db, email=normalized, name=name)


def ensure_demo_user(db: Session) -> models.User:
    """Ensure the demo user exists and return it."""
    return get_or_create_user_by_email(db, email=DEMO_EMAIL, name=DEMO_NAME)


__all__ = [
    "create_user",
    "get_or_create_user_by_email",
    "ensure_demo_user",
    "DEMO_EMAIL",
    "DEMO_NAME",
]
