import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, CHILE_TZ

SESSION_HOURS = 8
_PBKDF2_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()
    return f"{salt}:{pw_hash}"


def verify_password(password: str, stored: str) -> bool:
    salt, pw_hash = stored.split(":", 1)
    # Support both old (100k) and new (600k) iteration counts by trying stored count first.
    # We store the count in the hash prefix: "salt:hash" always used stored value.
    # For backwards compatibility: try 600k first, then 100k.
    for iterations in (_PBKDF2_ITERATIONS, 100_000):
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), iterations
        ).hex()
        if candidate == pw_hash:
            return True
    return False


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    token = authorization.split(" ", 1)[1]
    user = (
        db.query(User)
        .filter(User.session_token == token, User.is_active == 1)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    now = datetime.now(CHILE_TZ)
    if user.token_expires_at:
        exp = user.token_expires_at
        if exp.tzinfo is None:
            from zoneinfo import ZoneInfo
            exp = exp.replace(tzinfo=ZoneInfo("America/Santiago"))
        if now > exp:
            raise HTTPException(status_code=401, detail="Sesión expirada. Inicie sesión nuevamente.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Allow admin or superadmin (reviewer-level access: drafts, reviews)."""
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=403, detail="Se requieren permisos de administrador"
        )
    return user


def require_superadmin(user: User = Depends(get_current_user)) -> User:
    """Only superadmin: template management, user management, full control."""
    if user.role != "superadmin":
        raise HTTPException(
            status_code=403, detail="Se requieren permisos de superadministrador"
        )
    return user
