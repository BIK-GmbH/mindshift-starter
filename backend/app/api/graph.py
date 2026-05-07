from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.graph import GraphEdgeOut, GraphNodeOut, GraphViewOut, ReasonOut
from app.services.connections import get_global_graph

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("", response_model=GraphViewOut)
def global_graph(
    edges_per_card: int = Query(default=5, ge=1, le=20),
    min_score: float = Query(default=0.05, ge=0.0, le=1.0),
    source_type: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GraphViewOut:
    view = get_global_graph(
        db,
        current_user.id,
        edges_per_card=edges_per_card,
        min_score=min_score,
        source_type=source_type,
        tag=tag,
    )
    return GraphViewOut(
        nodes=[
            GraphNodeOut(
                id=n.id,
                title=n.title,
                source_type=n.source_type,
                thumbnail_url=n.thumbnail_url,
                tags=n.tags,
                degree=n.degree,
            )
            for n in view.nodes
        ],
        edges=[
            GraphEdgeOut(
                source=e.source,
                target=e.target,
                score=e.score,
                reasons=[ReasonOut(kind=r.kind, label=r.label, weight=r.weight) for r in e.reasons],
            )
            for e in view.edges
        ],
    )
