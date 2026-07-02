import os
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserDocument, DocumentEvent, DraftSubmission, BundleItem
from ..services.auth import get_current_user
from ..services.document_generator import GENERATED_DIR, convert_to_pdf

router = APIRouter(prefix="/api/repository", tags=["repository"])


def _safe_file_path(filename: str) -> str:
    if not filename or any(c in filename for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    path = os.path.abspath(os.path.join(GENERATED_DIR, filename))
    if not path.startswith(os.path.abspath(GENERATED_DIR)):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    return path


ROLE_LABELS = {
    "operativo": "Unidad Requirente",
    "admin": "Administrador Jurídico",
    "superadmin": "Superadministrador",
}


def _add_event(db: Session, doc_id: int, user: User, action: str, detail: str = ""):
    event = DocumentEvent(
        document_id=doc_id,
        action=action,
        actor_id=user.id,
        actor_role=user.role,
        detail=detail,
    )
    db.add(event)


@router.get("/")
def list_documents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    docs = (
        db.query(UserDocument)
        .filter(UserDocument.user_id == user.id)
        .order_by(UserDocument.created_at.desc())
        .all()
    )
    # Build a map of document_id → bundle info for fast lookup
    doc_ids_for_bundles = [d.id for d in docs]
    bundle_items = (
        db.query(BundleItem)
        .filter(BundleItem.document_id.in_(doc_ids_for_bundles))
        .all()
        if doc_ids_for_bundles else []
    )
    bundle_map = {
        bi.document_id: {"bundle_id": bi.bundle_id, "correlativo": bi.bundle.correlativo if bi.bundle else None}
        for bi in bundle_items
    }

    results = []
    for d in docs:
        jurisdiccion = ""
        if d.field_values_json:
            try:
                fv = json.loads(d.field_values_json)
                jurisdiccion = fv.get("jurisdiccion", "")
            except (json.JSONDecodeError, TypeError):
                pass
        bundle_info = bundle_map.get(d.id, {})
        results.append({
            "id": d.id,
            "document_name": d.document_name,
            "document_type": d.document_type,
            "template_name": d.template_name,
            "template_id_ref": d.template_id_ref,
            "category_name": d.category_name,
            "docx_filename": d.docx_filename,
            "jurisdiccion": jurisdiccion,
            "created_at": d.created_at.isoformat(),
            "bundle_id": bundle_info.get("bundle_id"),
            "bundle_correlativo": bundle_info.get("correlativo"),
        })
    return results


@router.get("/{doc_id}/events")
def get_document_events(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the traceability timeline for a document."""
    if user.role in ("admin", "superadmin"):
        doc = db.query(UserDocument).filter(UserDocument.id == doc_id).first()
    else:
        doc = (
            db.query(UserDocument)
            .filter(UserDocument.id == doc_id, UserDocument.user_id == user.id)
            .first()
        )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    return [
        {
            "id": e.id,
            "action": e.action,
            "actor_name": e.actor.name if e.actor else "",
            "actor_role": ROLE_LABELS.get(e.actor_role, e.actor_role),
            "detail": e.detail or "",
            "created_at": e.created_at.isoformat(),
        }
        for e in doc.events
    ]


@router.delete("/{doc_id}")
def delete_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == doc_id, UserDocument.user_id == user.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    submission = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.document_id == doc.id)
        .first()
    )
    if submission:
        status_labels = {
            "pendiente": "pendiente de revisión",
            "aprobado": "aprobado",
            "rechazado": "rechazado",
        }
        label = status_labels.get(submission.status, submission.status)
        raise HTTPException(
            status_code=400,
            detail=f"Solo se pueden eliminar borradores. Este documento está {label}.",
        )

    file_path = os.path.join(GENERATED_DIR, doc.docx_filename)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
        pdf_path = file_path.rsplit(".", 1)[0] + ".pdf"
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
    except OSError:
        pass

    db.delete(doc)
    db.commit()
    return {"message": "Documento eliminado"}


@router.get("/download/{filename}")
def download_docx(filename: str, user: User = Depends(get_current_user)):
    file_path = _safe_file_path(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )


@router.get("/download-pdf/{filename}")
def download_pdf(filename: str, user: User = Depends(get_current_user)):
    docx_path = _safe_file_path(filename)
    if not os.path.exists(docx_path):
        raise HTTPException(status_code=404, detail="Archivo DOCX no encontrado")

    pdf_path = convert_to_pdf(docx_path)
    if not pdf_path:
        raise HTTPException(
            status_code=500,
            detail="No se pudo convertir a PDF. Asegúrese de que LibreOffice esté instalado.",
        )
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=os.path.basename(pdf_path),
    )
