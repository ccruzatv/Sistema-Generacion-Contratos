import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InsumoDocumento, User
from ..services.auth import get_current_user
from ..services.extraction import extract_fields

router = APIRouter(prefix="/api/insumos", tags=["insumos"])

INSUMOS_DIR = os.environ.get(
    "INSUMOS_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "insumos"),
)
os.makedirs(INSUMOS_DIR, exist_ok=True)

_ALLOWED_EXT = {".pdf", ".docx", ".doc"}


@router.post("/upload")
async def upload_insumo(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a supporting document (insumo) and extract known contract fields from it."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Solo se admiten archivos PDF o Word (.pdf, .docx, .doc)")

    stored_name = f"{uuid.uuid4().hex[:12]}_{file.filename}"
    stored_path = os.path.join(INSUMOS_DIR, stored_name)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    with open(stored_path, "wb") as f:
        f.write(content)

    try:
        extracted = extract_fields(stored_path)
    except Exception as e:
        os.remove(stored_path)
        raise HTTPException(status_code=422, detail=f"No se pudo leer el documento: {str(e)}")

    insumo = InsumoDocumento(
        uploaded_by=user.id,
        filename=file.filename,
        stored_path=stored_name,
        extracted_data_json=json.dumps(extracted, ensure_ascii=False),
    )
    db.add(insumo)
    db.commit()
    db.refresh(insumo)

    return {
        "id": insumo.id,
        "filename": insumo.filename,
        "extracted": extracted,
    }


@router.delete("/{insumo_id}")
def delete_insumo(insumo_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    insumo = db.query(InsumoDocumento).filter(
        InsumoDocumento.id == insumo_id, InsumoDocumento.uploaded_by == user.id
    ).first()
    if not insumo:
        raise HTTPException(status_code=404, detail="Documento de insumo no encontrado")
    if insumo.document_id is not None:
        raise HTTPException(status_code=400, detail="No se puede eliminar: ya está vinculado a un documento generado")
    path = os.path.join(INSUMOS_DIR, insumo.stored_path)
    if os.path.exists(path):
        os.remove(path)
    db.delete(insumo)
    db.commit()
    return {"message": "Documento de insumo eliminado"}


@router.get("/document/{document_id}")
def list_insumos_for_document(document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List supporting documents linked to a generated document (audit/traceability)."""
    insumos = db.query(InsumoDocumento).filter(InsumoDocumento.document_id == document_id).all()
    return [
        {
            "id": i.id,
            "filename": i.filename,
            "extracted": json.loads(i.extracted_data_json) if i.extracted_data_json else {},
            "created_at": i.created_at.isoformat(),
        }
        for i in insumos
    ]
