from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    Index,
    LargeBinary,
    JSON,
)
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    projects = relationship("Project", back_populates="user")
    releases = relationship("Release", back_populates="user")
    routes = relationship("Route", back_populates="user")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    owner = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    releases = relationship("Release", back_populates="project", cascade="all, delete-orphan")
    routes = relationship("Route", back_populates="project", cascade="all, delete-orphan")
    user = relationship("User", back_populates="projects")


class Release(Base):
    __tablename__ = "releases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(String(64), nullable=False)
    notes = Column(Text, nullable=True)
    license_code = Column(String(64), nullable=True)
    license_custom_text = Column(Text, nullable=True)
    artifact_url = Column(String(2048), nullable=False)
    artifact_sha256 = Column(String(128), nullable=True)
    evidence_ipfs_cid = Column(String(128), nullable=True)
    # NFT tracking
    token_id = Column(Integer, nullable=True)
    metadata_ipfs_cid = Column(String(128), nullable=True)
    # Optional embedding column. In TiDB/MySQL with VECTOR type available, the actual
    # column is created via migration as VECTOR(768). We map it as LargeBinary here to
    # avoid dialect/type issues when reading. The app writes/read via raw SQL when needed.
    embedding = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="releases")
    user = relationship("User", back_populates="releases")


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_routes_slug"),
        Index("ix_routes_project_id", "project_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    slug = Column(String(128), nullable=False)
    target_url = Column(String(2048), nullable=False)
    release_id = Column(Integer, ForeignKey("releases.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="routes")
    release = relationship("Release")
    hits = relationship("RouteHit", back_populates="route", cascade="all, delete-orphan")
    user = relationship("User", back_populates="routes")


class RouteHit(Base):
    __tablename__ = "route_hits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ip = Column(String(64), nullable=True)
    ua = Column(String(512), nullable=True)
    ref = Column(String(2048), nullable=True)

    route = relationship("Route", back_populates="hits")


class ReleasesStaging(Base):
    __tablename__ = "releases_staging"

    id = Column(Integer, primary_key=True, autoincrement=True)
    artifact_url = Column(Text, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Audit(Base):
    __tablename__ = "audit"
    __table_args__ = (
        Index("ix_audit_ts", "ts"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(Integer, nullable=False)
    action = Column(String(64), nullable=False)
    meta = Column(JSON, nullable=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class APIKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        UniqueConstraint("key_id", name="uq_api_keys_key_id"),
        Index("ix_api_keys_user_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key_id = Column(String(64), nullable=False)
    # We store a randomly generated signing secret string here (named secret_hash per spec)
    secret_hash = Column(String(128), nullable=False)
    active = Column(Integer, nullable=False, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User")
