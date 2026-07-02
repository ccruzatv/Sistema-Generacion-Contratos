from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category
from ..schemas import CategoryResponse, CategoryCreate
from ..services.auth import get_current_user, require_superadmin

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryRename(BaseModel):
    name: str


def _build_response(c: Category) -> CategoryResponse:
    return CategoryResponse(
        id=c.id,
        name=c.name,
        order=c.order,
        parent_id=c.parent_id,
        template_count=len(c.templates),
        children=[
            CategoryResponse(
                id=ch.id,
                name=ch.name,
                order=ch.order,
                parent_id=ch.parent_id,
                template_count=len(ch.templates),
            )
            for ch in sorted(c.children, key=lambda x: x.order)
        ],
    )


@router.get("/", response_model=list[CategoryResponse])
def list_categories(
    parent_id: int | None = None,
    top_level: bool = False,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if top_level:
        cats = db.query(Category).filter(Category.parent_id.is_(None)).order_by(Category.order).all()
        return [_build_response(c) for c in cats]

    if parent_id is not None:
        cats = db.query(Category).filter(Category.parent_id == parent_id).order_by(Category.order).all()
        return [_build_response(c) for c in cats]

    cats = db.query(Category).order_by(Category.order).all()
    return [_build_response(c) for c in cats]


@router.post("/", response_model=CategoryResponse)
def create_category(
    data: CategoryCreate,
    admin=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    existing = db.query(Category).filter(
        Category.name == data.name,
        Category.parent_id == data.parent_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe una carpeta con ese nombre en este nivel")

    # Auto-assign order as max + 1 within same parent
    siblings = db.query(Category).filter(Category.parent_id == data.parent_id).all()
    order = max((s.order for s in siblings), default=-1) + 1

    category = Category(name=data.name, order=order, parent_id=data.parent_id)
    db.add(category)
    db.commit()
    db.refresh(category)
    return _build_response(category)


@router.put("/{category_id}", response_model=CategoryResponse)
def rename_category(
    category_id: int,
    data: CategoryRename,
    admin=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")

    duplicate = db.query(Category).filter(
        Category.name == name,
        Category.parent_id == category.parent_id,
        Category.id != category_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Ya existe una carpeta con ese nombre en este nivel")

    category.name = name
    db.commit()
    db.refresh(category)
    return _build_response(category)


@router.delete("/{category_id}")
def delete_category(
    category_id: int,
    admin=Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    category = db.query(Category).filter(Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    if len(category.templates) > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar una carpeta con plantillas asignadas",
        )
    if len(category.children) > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar un tipo de contrato que tiene subcarpetas",
        )
    db.delete(category)
    db.commit()
    return {"message": "Carpeta eliminada"}

