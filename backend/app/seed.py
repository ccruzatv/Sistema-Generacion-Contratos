from sqlalchemy.orm import Session
from .models import User, Category, Template, DocumentBundle
from .services.auth import hash_password

CONTRACT_TYPES = [
    "Contratos de aseo e insumos",
    "Contratos de construcción y obras",
    "Contratos de guardias de seguridad",
    "Contratos de suministro de agua purificada",
    "Contratos de mantención y certificación de ascensores y salvaescaleras",
    "Contratos de mantención de jardines y áreas verdes",
    "Contratos de transporte de funcionarios y notificadores judiciales",
]

SUBCATEGORIES = [
    "Contratos",
    "Anexos",
]

DEFAULT_SUPERADMIN_EMAIL = "superadmin@pjud.cl"
DEFAULT_SUPERADMIN_PASSWORD = "superadmin123"

DEFAULT_ADMIN_EMAIL = "admin@pjud.cl"
DEFAULT_ADMIN_PASSWORD = "admin123"
DEFAULT_ADMIN_NAME = "Administrador Jurídico"

DEFAULT_OPERATIVO_EMAIL = "operativo@pjud.cl"
DEFAULT_OPERATIVO_PASSWORD = "operativo123"

_OLD_ADMIN_NAME = "Administrador"


def seed_database(db: Session) -> None:
    _seed_superadmin(db)
    _seed_admin(db)
    _seed_operativo(db)
    _seed_categories(db)
    _migrate_categories(db)


def _seed_superadmin(db: Session) -> None:
    existing = db.query(User).filter(User.email == DEFAULT_SUPERADMIN_EMAIL).first()
    if existing:
        return
    superadmin = User(
        email=DEFAULT_SUPERADMIN_EMAIL,
        name="Superadministrador",
        password_hash=hash_password(DEFAULT_SUPERADMIN_PASSWORD),
        role="superadmin",
    )
    db.add(superadmin)
    db.commit()


def _seed_admin(db: Session) -> None:
    existing = db.query(User).filter(User.email == DEFAULT_ADMIN_EMAIL).first()
    if existing:
        if existing.name == _OLD_ADMIN_NAME:
            existing.name = DEFAULT_ADMIN_NAME
            db.commit()
        return
    admin = User(
        email=DEFAULT_ADMIN_EMAIL,
        name=DEFAULT_ADMIN_NAME,
        password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
        role="admin",
    )
    db.add(admin)
    db.commit()


def _seed_operativo(db: Session) -> None:
    existing = db.query(User).filter(User.email == DEFAULT_OPERATIVO_EMAIL).first()
    if existing:
        return
    operativo = User(
        email=DEFAULT_OPERATIVO_EMAIL,
        name="Usuario Operativo",
        password_hash=hash_password(DEFAULT_OPERATIVO_PASSWORD),
        role="operativo",
    )
    db.add(operativo)
    db.commit()


def _seed_categories(db: Session) -> None:
    has_subcategories = db.query(Category).filter(Category.parent_id.isnot(None)).count()
    if has_subcategories > 0:
        return

    for i, ct_name in enumerate(CONTRACT_TYPES):
        ct = Category(name=ct_name, order=i, parent_id=None)
        db.add(ct)
        db.flush()

        for j, sub_name in enumerate(SUBCATEGORIES):
            db.add(Category(name=sub_name, order=j, parent_id=ct.id))

    db.commit()


def _delete_category_tree(db: Session, top: Category) -> None:
    """Delete a top-level category, its subcategories, and detach any
    templates/expedientes that referenced them (no destructive DB cascade
    exists at the schema level, so this is done explicitly)."""
    subs = db.query(Category).filter(Category.parent_id == top.id).all()
    for sub in subs:
        db.query(Template).filter(Template.category_id == sub.id).update({"category_id": None})
        db.delete(sub)
    db.query(DocumentBundle).filter(DocumentBundle.category_id == top.id).update({"category_id": None})
    db.delete(top)


def _migrate_categories(db: Session) -> None:
    """Reset los tipos de contrato a las 7 carpetas oficiales, cada una con
    únicamente dos subcarpetas: 'Contratos' y 'Anexos'. Elimina tipos y
    subcarpetas antiguos (licitaciones, bases, anexos con nombre fijo)."""

    valid_names = set(CONTRACT_TYPES)
    top_levels = db.query(Category).filter(Category.parent_id.is_(None)).all()
    changed = False

    for ct in top_levels:
        if ct.name not in valid_names:
            _delete_category_tree(db, ct)
            changed = True

    for i, name in enumerate(CONTRACT_TYPES):
        ct = db.query(Category).filter(
            Category.name == name, Category.parent_id.is_(None)
        ).first()
        if not ct:
            ct = Category(name=name, order=i, parent_id=None)
            db.add(ct)
            db.flush()
            changed = True
        elif ct.order != i:
            ct.order = i
            changed = True

        existing_subs = (
            db.query(Category)
            .filter(Category.parent_id == ct.id)
            .order_by(Category.order)
            .all()
        )
        existing_names = {s.name for s in existing_subs}

        for sub in existing_subs:
            if sub.name not in SUBCATEGORIES:
                db.query(Template).filter(Template.category_id == sub.id).update({"category_id": None})
                db.delete(sub)
                changed = True

        for j, sub_name in enumerate(SUBCATEGORIES):
            if sub_name not in existing_names:
                db.add(Category(name=sub_name, order=j, parent_id=ct.id))
                changed = True
            else:
                for sub in existing_subs:
                    if sub.name == sub_name and sub.order != j:
                        sub.order = j
                        changed = True

    if changed:
        db.commit()
