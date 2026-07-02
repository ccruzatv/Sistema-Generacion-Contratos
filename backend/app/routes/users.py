from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserUpdate, UserResponse
from ..services.auth import require_admin, require_superadmin, hash_password
from ..services.email_service import send_invitation_email

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=list[UserResponse])
def list_users(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.created_at.desc()).all()


@router.post("/", response_model=UserResponse)
def create_user(
    data: UserCreate,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="El correo ya está registrado")

    if data.role not in ("admin", "operativo", "superadmin"):
        raise HTTPException(status_code=400, detail="Rol inválido")

    user = User(
        email=data.email,
        name=data.name,
        role=data.role,
        jurisdiccion=data.jurisdiccion or None,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    send_invitation_email(
        to_email=data.email,
        user_name=data.name,
        temp_password=data.password,
        role=data.role,
    )

    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UserUpdate,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if data.name is not None:
        user.name = data.name
    if data.role is not None:
        if data.role not in ("admin", "operativo", "superadmin"):
            raise HTTPException(status_code=400, detail="Rol inválido")
        user.role = data.role
    if data.jurisdiccion is not None:
        user.jurisdiccion = data.jurisdiccion or None
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password is not None:
        user.password_hash = hash_password(data.password)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="No puede eliminarse a sí mismo")

    db.delete(user)
    db.commit()
    return {"message": "Usuario eliminado"}
