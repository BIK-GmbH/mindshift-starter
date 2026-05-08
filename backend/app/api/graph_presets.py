from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.graph_preset import GraphPreset
from app.models.user import User
from app.schemas.graph_preset import GraphPresetCreate, GraphPresetOut

router = APIRouter(prefix="/graph-presets", tags=["graph-presets"])


@router.get("", response_model=list[GraphPresetOut])
def list_presets(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GraphPresetOut]:
    rows = db.execute(
        select(GraphPreset)
        .where(GraphPreset.user_id == current_user.id)
        .order_by(GraphPreset.created_at.desc())
    ).scalars().all()
    return [
        GraphPresetOut(
            id=p.id,
            name=p.name,
            settings=p.settings_json,
            created_at=p.created_at,
        )
        for p in rows
    ]


@router.post("", response_model=GraphPresetOut, status_code=201)
def create_preset(
    payload: GraphPresetCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GraphPresetOut:
    preset = GraphPreset(
        user_id=current_user.id,
        name=payload.name.strip(),
        settings_json=payload.settings,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return GraphPresetOut(
        id=preset.id,
        name=preset.name,
        settings=preset.settings_json,
        created_at=preset.created_at,
    )


@router.delete("/{preset_id}", status_code=204)
def delete_preset(
    preset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    preset = db.execute(
        select(GraphPreset).where(
            GraphPreset.id == preset_id, GraphPreset.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(preset)
    db.commit()
