from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.chat import ChatMessage as ChatMessageModel
from app.models.chat import ChatSession
from app.models.user import User
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    ChatSessionCreate,
    ChatSessionDetail,
    ChatSessionOut,
    ChatSessionUpdate,
    CitationOut,
)
from app.services.chat import ChatMessage, chat_with_card, chat_with_kb

router = APIRouter(tags=["chat"])


def _to_history(payload: ChatRequest) -> list[ChatMessage]:
    return [ChatMessage(role=m.role, content=m.content) for m in payload.messages]


def _ensure_session(
    db: Session,
    user: User,
    payload: ChatRequest,
    *,
    card_id: UUID | None,
) -> ChatSession | None:
    """If `session_id` is provided, validate ownership; else create new."""
    if payload.session_id is None:
        return _create_session(db, user, card_id=card_id, first_message=payload.messages[-1].content)

    session = db.get(ChatSession, payload.session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


def _create_session(
    db: Session, user: User, *, card_id: UUID | None, first_message: str
) -> ChatSession:
    title = first_message.strip().splitlines()[0][:80] if first_message else "New chat"
    session = ChatSession(user_id=user.id, card_id=card_id, title=title)
    db.add(session)
    db.flush()
    return session


def _persist_messages(
    db: Session,
    session: ChatSession,
    user_msg: str,
    assistant_msg: str,
    citations: list | None,
) -> None:
    db.add(ChatMessageModel(session_id=session.id, role="user", content=user_msg))
    db.add(
        ChatMessageModel(
            session_id=session.id,
            role="assistant",
            content=assistant_msg,
            citations_json=citations,
        )
    )
    # Bump updated_at
    session.updated_at = func.now()
    db.commit()


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

    session = _ensure_session(db, current_user, payload, card_id=card_id)

    try:
        result = chat_with_card(db, card, _to_history(payload))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _persist_messages(db, session, payload.messages[-1].content, result.answer, None)

    return ChatResponse(answer=result.answer, session_id=session.id)


@router.post("/chat", response_model=ChatResponse)
def chat_kb(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatResponse:
    session = _ensure_session(db, current_user, payload, card_id=None)

    try:
        result = chat_with_kb(db, current_user.id, _to_history(payload), top_k=payload.top_k)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    citations_payload = [
        {
            "index": c.index,
            "card_id": str(c.card_id),
            "title": c.title,
            "source_type": c.source_type,
            "chunk_index": c.chunk_index,
            "snippet": c.snippet,
        }
        for c in result.citations
    ]
    _persist_messages(db, session, payload.messages[-1].content, result.answer, citations_payload)

    return ChatResponse(
        answer=result.answer,
        session_id=session.id,
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


# --- Sessions CRUD ---------------------------------------------------------


@router.get("/chat/sessions", response_model=list[ChatSessionOut])
def list_sessions(
    card_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatSessionOut]:
    """List chat sessions for the current user. Optional `card_id` filter."""
    msg_count_subq = (
        select(
            ChatMessageModel.session_id,
            func.count(ChatMessageModel.id).label("c"),
        )
        .group_by(ChatMessageModel.session_id)
        .subquery()
    )

    stmt = (
        select(ChatSession, func.coalesce(msg_count_subq.c.c, 0))
        .outerjoin(msg_count_subq, msg_count_subq.c.session_id == ChatSession.id)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
    )
    if card_id is not None:
        stmt = stmt.where(ChatSession.card_id == card_id)

    rows = db.execute(stmt).all()
    return [
        ChatSessionOut(
            id=session.id,
            title=session.title,
            card_id=session.card_id,
            created_at=session.created_at,
            updated_at=session.updated_at,
            message_count=int(count or 0),
        )
        for session, count in rows
    ]


@router.post("/chat/sessions", response_model=ChatSessionOut)
def create_session(
    payload: ChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    if payload.card_id is not None:
        card = db.get(Card, payload.card_id)
        if card is None or card.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Card not found")
    session = ChatSession(
        user_id=current_user.id,
        card_id=payload.card_id,
        title=(payload.title or "New chat").strip()[:80] or "New chat",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return ChatSessionOut(
        id=session.id,
        title=session.title,
        card_id=session.card_id,
        created_at=session.created_at,
        updated_at=session.updated_at,
        message_count=0,
    )


@router.get("/chat/sessions/{session_id}", response_model=ChatSessionDetail)
def get_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionDetail:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


@router.patch("/chat/sessions/{session_id}", response_model=ChatSessionOut)
def update_session(
    session_id: UUID,
    payload: ChatSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found")
    if payload.title is not None:
        session.title = payload.title.strip()[:500] or session.title
    db.commit()
    db.refresh(session)
    return ChatSessionOut(
        id=session.id,
        title=session.title,
        card_id=session.card_id,
        created_at=session.created_at,
        updated_at=session.updated_at,
        message_count=len(session.messages),
    )


@router.delete("/chat/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    session = db.get(ChatSession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Chat session not found")
    db.delete(session)
    db.commit()
