import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.evidence import build_evidence_zip, compute_artifact_sha256


def _make_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    models.Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    return SessionLocal()


def test_compute_artifact_sha256_local_file(tmp_path: Path):
    target = tmp_path / "artifact.bin"
    target.write_bytes(b"routeforge")

    digest = compute_artifact_sha256(str(target))
    assert digest == "0dfc85ef1f8df522f0ad67f012956324b6dc34d00ba3ede7d483c10af37966d5"


def test_build_evidence_zip_contains_expected_files(tmp_path: Path):
    session = _make_session()
    now = datetime.now(timezone.utc)
    project = models.Project(user_id=1, name="Demo", owner="demo", description="", created_at=now)
    session.add(project)
    session.flush()

    release = models.Release(
        user_id=1,
        project_id=project.id,
        version="1.0.0",
        notes="First release",
        artifact_url="https://example.com/demo.tar.gz",
        artifact_sha256="abc123",
        created_at=now,
    )
    session.add(release)
    session.flush()

    route = models.Route(
        user_id=1,
        project_id=project.id,
        slug="demo",
        target_url="https://example.com/demo",
        release_id=release.id,
        created_at=now,
    )
    session.add(route)
    session.flush()

    hit = models.RouteHit(
        route_id=route.id,
        ts=now - timedelta(days=1),
        ip="127.0.0.1",
        ua="pytest",
        ref="https://example.com",
    )
    session.add(hit)

    audit_release = models.Audit(
        entity_type="release",
        entity_id=release.id,
        action="publish",
        meta={"project_id": project.id},
        ts=now,
    )
    session.add(audit_release)

    session.commit()

    payload = build_evidence_zip(release.id, session)

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = set(archive.namelist())
        assert {"release.json", "routes.json", "audit.json", "hits.csv"}.issubset(entries)

        release_doc = json.loads(archive.read("release.json"))
        assert release_doc["artifact_sha256"] == "abc123"
        assert release_doc["project"]["name"] == "Demo"

        hits_doc = archive.read("hits.csv").decode()
        lines = hits_doc.splitlines()
        assert lines[0] == "ts,route_id,route_slug,ip,ua,ref"


def test_build_evidence_zip_includes_license_content():
    session = _make_session()
    now = datetime.now(timezone.utc)
    project = models.Project(user_id=1, name="Demo", owner="demo", description="", created_at=now)
    session.add(project)
    session.flush()

    release = models.Release(
        user_id=1,
        project_id=project.id,
        version="1.0.1",
        notes="With license",
        artifact_url="https://example.com/license.tar.gz",
        artifact_sha256="def456",
        created_at=now,
        license_code="MIT",
    )
    session.add(release)
    session.commit()

    payload = build_evidence_zip(release.id, session)

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert "LICENSE.md" in archive.namelist()
        license_text = archive.read("LICENSE.md").decode()
        assert "MIT License" in license_text

    release.license_code = "CUSTOM"
    release.license_custom_text = "Redistribution restricted to partners."
    session.add(release)
    session.commit()

    payload_custom = build_evidence_zip(release.id, session)
    with zipfile.ZipFile(io.BytesIO(payload_custom)) as archive:
        assert "LICENSE.md" in archive.namelist()
        license_text_custom = archive.read("LICENSE.md").decode()
        assert "Custom License" in license_text_custom
        assert "Redistribution restricted" in license_text_custom
