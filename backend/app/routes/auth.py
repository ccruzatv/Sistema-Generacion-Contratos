from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, CHILE_TZ
from ..schemas import LoginRequest, LoginResponse, UserResponse
from ..services.auth import verify_password, generate_token, get_current_user, SESSION_HOURS

router = APIRouter(prefix="/api/auth", tags=["auth"])
_limiter = Limiter(key_func=get_remote_address)


@router.post("/login", response_model=LoginResponse)
@_limiter.limit("5/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Cuenta desactivada")

    token = generate_token()
    user.session_token = token
    user.token_expires_at = datetime.now(CHILE_TZ) + timedelta(hours=SESSION_HOURS)
    db.commit()

    return LoginResponse(
        token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
def get_me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout")
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.session_token = None
    user.token_expires_at = None
    db.commit()
    return {"message": "Sesión cerrada"}
