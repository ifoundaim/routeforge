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


class ReleaseLicenseUpdate(BaseModel):
    license_code: str
    custom_text: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class ReleaseLicenseOut(BaseModel):
    license_code: str
    license_url: Optional[str] = None
    license_custom_text: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ReleaseOut(BaseModel):
    id: int
    project_id: int
    version: str
    notes: Optional[str] = None
    artifact_url: str
    artifact_sha256: Optional[str] = None
    license_code: Optional[str] = None
    license_custom_text: Optional[str] = None
    license_url: Optional[str] = None
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

