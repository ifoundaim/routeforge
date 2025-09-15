from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# Project DTOs
class ProjectCreate(BaseModel):
    name: str
    owner: str
    description: Optional[str] = None


class ProjectOut(BaseModel):
    id: int
    name: str
    owner: str
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Release DTOs
class ReleaseCreate(BaseModel):
    project_id: int
    version: str
    artifact_url: str
    notes: Optional[str] = None


class ReleaseOut(BaseModel):
    id: int
    project_id: int
    version: str
    notes: Optional[str] = None
    artifact_url: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Route DTOs
class RouteCreate(BaseModel):
    project_id: int
    slug: str
    target_url: str
    release_id: Optional[int] = None


class RouteOut(BaseModel):
    id: int
    project_id: int
    slug: str
    target_url: str
    release_id: Optional[int]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReleaseDetailOut(ReleaseOut):
    project: ProjectOut
    latest_route: Optional[RouteOut] = None


