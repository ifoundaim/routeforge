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
)
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    owner = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    releases = relationship("Release", back_populates="project", cascade="all, delete-orphan")
    routes = relationship("Route", back_populates="project", cascade="all, delete-orphan")


class Release(Base):
    __tablename__ = "releases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(String(64), nullable=False)
    notes = Column(Text, nullable=True)
    artifact_url = Column(String(2048), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="releases")


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_routes_slug"),
        Index("ix_routes_project_id", "project_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    slug = Column(String(128), nullable=False)
    target_url = Column(String(2048), nullable=False)
    release_id = Column(Integer, ForeignKey("releases.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    project = relationship("Project", back_populates="routes")
    release = relationship("Release")
    hits = relationship("RouteHit", back_populates="route", cascade="all, delete-orphan")


class RouteHit(Base):
    __tablename__ = "route_hits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ip = Column(String(64), nullable=True)
    ua = Column(String(512), nullable=True)
    ref = Column(String(2048), nullable=True)

    route = relationship("Route", back_populates="hits")


