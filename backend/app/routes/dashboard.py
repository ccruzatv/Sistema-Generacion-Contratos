from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserDocument, DocumentBundle, DraftSubmission, Template
from ..services.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
def get_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "operativo":
        docs = db.query(UserDocument).filter(UserDocument.user_id == user.id).all()
        doc_ids = [d.id for d in docs]
        if doc_ids:
            subs = db.query(DraftSubmission).filter(DraftSubmission.document_id.in_(doc_ids)).all()
        else:
            subs = []
        sub_map = {s.document_id: s for s in subs}

        pendiente = sum(1 for s in subs if s.status == "pendiente")
        aprobado = sum(1 for s in subs if s.status == "aprobado")
        rechazado = sum(1 for s in subs if s.status == "rechazado")
        borrador = len(docs) - len(subs)

        bundles = db.query(DocumentBundle).filter(DocumentBundle.user_id == user.id).all()
        expedientes_activos = sum(1 for b in bundles if not all(it.is_completed for it in b.items))

        return {
            "role": "operativo",
            "total_documentos": len(docs),
            "borradores": borrador,
            "pendiente": pendiente,
            "aprobado": aprobado,
            "rechazado": rechazado,
            "expedientes_total": len(bundles),
            "expedientes_activos": expedientes_activos,
        }

    if user.role in ("admin", "superadmin"):
        pending_reviews = db.query(DraftSubmission).filter(DraftSubmission.status == "pendiente").count()
        aprobados = db.query(DraftSubmission).filter(DraftSubmission.status == "aprobado").count()
        rechazados = db.query(DraftSubmission).filter(DraftSubmission.status == "rechazado").count()
        total_docs = db.query(UserDocument).count()
        total_users = db.query(User).filter(User.is_active == 1).count()
        total_templates = db.query(Template).count()

        return {
            "role": user.role,
            "pendiente": pending_reviews,
            "aprobado": aprobados,
            "rechazado": rechazados,
            "total_documentos": total_docs,
            "total_users": total_users,
            "total_templates": total_templates,
        }

    return {}
