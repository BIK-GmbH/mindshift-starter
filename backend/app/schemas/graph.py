from uuid import UUID

from pydantic import BaseModel


class ReasonOut(BaseModel):
    kind: str
    label: str
    weight: float


class ConnectionOut(BaseModel):
    card_id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    tags: list[str] = []
    score: float
    reasons: list[ReasonOut]


class GraphNodeOut(BaseModel):
    id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    tags: list[str] = []
    degree: int = 0


class GraphEdgeOut(BaseModel):
    source: UUID
    target: UUID
    score: float
    reasons: list[ReasonOut]


class GraphViewOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


class PathRequest(BaseModel):
    from_id: UUID
    to_id: UUID
    max_hops: int = 6


class PathResponse(BaseModel):
    path: list[UUID]
    found: bool
    hops: int
