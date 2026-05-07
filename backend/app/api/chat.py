from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.user import User
from app.schemas.chat import ChatRequest, ChatResponse, CitationOut
from app.services.chat import ChatMessage, chat_with_card, chat_with_kb

router = APIRouter(tags=["chat"])


def _to_history(payload: ChatRequest) -> list[ChatMessage]:
    return [ChatMessage(role=m.role, content=m.content) for m in payload.messages]


@router.post("/cards/{card_id}/chat", response_model=ChatResponse)
def chat_card(
    card_id: UUID,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    try:
        result = chat_with_card(db, card, _to_history(payload))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ChatResponse(answer=result.answer)


@router.post("/chat", response_model=ChatResponse)
def chat_kb(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    try:
        result = chat_with_kb(db, current_user.id, _to_history(payload), top_k=payload.top_k)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ChatResponse(
        answer=result.answer,
        citations=[
            CitationOut(
                index=c.index,
                card_id=c.card_id,
                title=c.title,
                source_type=c.source_type,
                chunk_index=c.chunk_index,
                snippet=c.snippet,
            )
            for c in result.citations
        ],
    )
