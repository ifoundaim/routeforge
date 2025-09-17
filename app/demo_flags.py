"""Helpers for demo-only behavior toggled via environment flags."""
from __future__ import annotations

import os


_TRUE_VALUES = {"1", "true", "yes", "on"}


def is_demo() -> bool:
    """Return True when demo mode should be used."""
    raw = os.getenv("DEMO_MODE", "1")
    if raw is None:
        return False
    value = raw.strip().lower()
    if value == "":
        return False
    return value in _TRUE_VALUES
