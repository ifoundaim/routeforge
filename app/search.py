import hashlib
import logging
import os
from typing import List, Dict, Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("routeforge.search")


def _embedding_enabled() -> bool:
    return (os.getenv("EMBEDDING_ENABLED") or "0").strip() == "1"


def _similarity_threshold() -> float:
    try:
        return float(os.getenv("SIMILARITY_THRESHOLD", "0.83"))
    except Exception:
        return 0.83


def _hash_to_vector_768(text_value: str) -> list[float]:
    # Deterministic stub: expand sha256 digest repeatedly to 768 dims in [0,1]
    seed = text_value.encode("utf-8")
    vec: list[float] = []
    current = seed
    while len(vec) < 768:
        d = hashlib.sha256(current).digest()
        for b in d:
            vec.append(b / 255.0)
            if len(vec) >= 768:
                break
        current = d
    return vec


def search_similar_releases(db: Session, query_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    if not query_text:
        return []

    if _embedding_enabled():
        try:
            q_vec = _hash_to_vector_768(query_text)
            # TiDB uses operator <-> for vector distance. We pass vector as JSON array string.
            try:
                rows = db.execute(
                    text(
                        """
                        SELECT id, project_id, version, notes, (embedding <-> :q) AS distance
                        FROM releases
                        WHERE embedding IS NOT NULL
                        ORDER BY embedding <-> :q
                        LIMIT :k
                        """
                    ),
                    {"q": str(q_vec), "k": int(top_k)},
                ).mappings().all()
            except Exception:
                # Some dialects need explicit cast or different param style; try a second form
                rows = db.execute(
                    text(
                        """
                        SELECT id, project_id, version, notes, (embedding <-> :q) AS distance
                        FROM releases
                        WHERE embedding IS NOT NULL
                        ORDER BY (embedding <-> :q)
                        LIMIT :k
                        """
                    ),
                    {"q": str(q_vec), "k": int(top_k)},
                ).mappings().all()

            # Convert to similarity [0..1] via cosine-like heuristic: 1 / (1 + distance)
            items: List[Dict[str, Any]] = []
            for r in rows:
                dist = float(r.get("distance") or 0.0)
                score = 1.0 / (1.0 + dist)
                items.append({
                    "id": r["id"],
                    "version": r["version"],
                    "notes": r["notes"],
                    "score": score,
                })
            return items
        except Exception as exc:
            logger.warning("Vector search failed, falling back to full-text: %s", exc)

    # Full-text fallback using MySQL/TiDB fulltext semantics
    rows = []
    try:
        rows = db.execute(
            text(
                """
                SELECT id, project_id, version, notes
                FROM releases
                WHERE MATCH(notes, version) AGAINST(:q IN NATURAL LANGUAGE MODE)
                LIMIT :k
                """
            ),
            {"q": query_text, "k": int(top_k)},
        ).mappings().all()
    except Exception:
        # Poor-man fallback if FULLTEXT not available: simple LIKE search
        rows = db.execute(
            text(
                """
                SELECT id, project_id, version, notes
                FROM releases
                WHERE (notes IS NOT NULL AND notes LIKE :like)
                   OR version LIKE :like
                LIMIT :k
                """
            ),
            {"like": f"%{query_text}%", "k": int(top_k)},
        ).mappings().all()

    # Crude textual score: higher for earlier rows
    items: List[Dict[str, Any]] = []
    for idx, r in enumerate(rows):
        score = 1.0 / float(idx + 1)
        items.append({
            "id": r["id"],
            "version": r["version"],
            "notes": r["notes"],
            "score": score,
        })
    return items


