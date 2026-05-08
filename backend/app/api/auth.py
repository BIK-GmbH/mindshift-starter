from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, ProfileUpdate, RegisterRequest, TokenResponse, UserOut
from app.services.storage import get_storage

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=payload.email.lower(),
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2 MiB
ALLOWED_AVATAR_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if payload.display_name is not None:
        current_user.display_name = payload.display_name.strip() or None

    if payload.bio is not None:
        current_user.bio = payload.bio.strip() or None

    if payload.username is not None:
        new_username = payload.username.lower().strip()
        if new_username != (current_user.username or ""):
            taken = db.execute(
                select(User.id).where(
                    User.username == new_username, User.id != current_user.id
                )
            ).first()
            if taken is not None:
                raise HTTPException(status_code=409, detail="Username is already taken")
            current_user.username = new_username

    if payload.public_profile is not None:
        # The public profile cannot be enabled without a username — that
        # would give every public route a 404 anyway.
        if payload.public_profile and not current_user.username:
            raise HTTPException(
                status_code=400, detail="Set a username before enabling the public profile"
            )
        current_user.public_profile = payload.public_profile

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if file.content_type not in ALLOWED_AVATAR_MIMES:
        raise HTTPException(
            status_code=400, detail="Avatar must be PNG, JPEG, WebP, or GIF"
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar exceeds 2 MiB limit")

    saved = get_storage().save(
        db,
        user_id=current_user.id,
        content=content,
        original_filename=file.filename or "avatar",
        content_type=file.content_type,
        purpose="avatar",
    )
    current_user.avatar_file_id = saved.id
    db.commit()
    db.refresh(current_user)
    return current_user


@router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    current_user.avatar_file_id = None
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/extension-token", response_model=TokenResponse)
def extension_token(current_user: User = Depends(get_current_user)) -> TokenResponse:
    """Mint a long-lived JWT for the browser extension.

    The extension stores this in `chrome.storage.local`. The token is
    valid for 365 days; revocation is via the user changing their
    password (which doesn't currently invalidate JWTs — this is a
    single-user app, accept the risk for now).
    """
    long_lived_minutes = 60 * 24 * 365  # 1 year
    return TokenResponse(access_token=create_access_token(current_user.id, expires_minutes=long_lived_minutes))
