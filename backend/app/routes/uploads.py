from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import UploadLog, User
from ..services.auth import require_superadmin

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.get("/historial")
def get_historial(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    rows = db.query(UploadLog).order_by(UploadLog.created_at.desc()).limit(50).all()
    return [
        {
            "id": r.id,
            "source": r.source,
            "filename": r.filename,
            "record_count": r.record_count,
            "uploaded_by": r.uploaded_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
