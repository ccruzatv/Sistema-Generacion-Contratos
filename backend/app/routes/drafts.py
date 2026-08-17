import os
import json
import shutil
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserDocument, DraftSubmission, Notification, DocumentEvent
from ..services.auth import get_current_user, require_admin
from ..services.email_service import send_draft_notification_email, send_approval_email, send_rejection_email
from ..services.document_generator import GENERATED_DIR, add_validation_footer, add_pending_footer, convert_to_pdf

try:
    CHILE_TZ = ZoneInfo("America/Santiago")
except KeyError:
    CHILE_TZ = timezone(timedelta(hours=-4))

router = APIRouter(prefix="/api/drafts", tags=["drafts"])

_TEMPLATES_DIR = os.environ.get(
    "TEMPLATES_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates"),
)


def _resolve_template_path(stored: str) -> str:
    """Resolve stored file_path to absolute path (supports legacy absolute paths)."""
    if os.path.isabs(stored):
        return stored
    return os.path.join(_TEMPLATES_DIR, stored)


def _submission_number(db: Session, submission: DraftSubmission) -> int:
    """1-indexed position of this submission among all submission cycles for its document."""
    return (
        db.query(DraftSubmission)
        .filter(
            DraftSubmission.document_id == submission.document_id,
            DraftSubmission.submitted_at <= submission.submitted_at,
        )
        .count()
    )


class SubmitDraftRequest(BaseModel):
    document_id: int
    comment: str = ""


class ReviewDraftRequest(BaseModel):
    status: str  # aprobado, rechazado
    comment: str = ""


@router.post("/submit")
def submit_draft(
    request: SubmitDraftRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Operativo submits a document draft for admin review."""
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == request.document_id, UserDocument.user_id == user.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    existing_approved = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.document_id == doc.id, DraftSubmission.status == "aprobado")
        .first()
    )
    if existing_approved:
        raise HTTPException(status_code=400, detail="Este documento ya fue aprobado y no puede enviarse nuevamente")
    existing_pending = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.document_id == doc.id, DraftSubmission.status == "pendiente")
        .first()
    )
    if existing_pending:
        raise HTTPException(status_code=400, detail="Este documento ya tiene un envío pendiente de revisión")

    submitter_comment = (request.comment or "").strip()
    submission = DraftSubmission(
        document_id=doc.id,
        submitted_by=user.id,
        status="pendiente",
        submitter_comment=submitter_comment,
    )
    db.add(submission)

    event_detail = "Borrador enviado para validación"
    if submitter_comment:
        event_detail += f". Comentario del solicitante: {submitter_comment}"
    event = DocumentEvent(
        document_id=doc.id,
        action="enviado",
        actor_id=user.id,
        actor_role=user.role,
        detail=event_detail,
    )
    db.add(event)

    # Notify all admins and superadmins
    admins = db.query(User).filter(User.role.in_(["admin", "superadmin"]), User.is_active == 1).all()
    for admin in admins:
        notification = Notification(
            user_id=admin.id,
            message=f"{user.name} ha enviado el borrador \"{doc.document_name}\" para su revisión.",
            link="/admin/reviews",
        )
        db.add(notification)
        # Send email notification
        send_draft_notification_email(
            to_email=admin.email,
            admin_name=admin.name,
            submitter_name=user.name,
            document_name=doc.document_name,
        )

    db.commit()
    return {"message": "Borrador enviado para revisión"}


@router.get("/my-submissions")
def my_submissions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all draft submissions made by the current user."""
    submissions = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.submitted_by == user.id)
        .order_by(DraftSubmission.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "document_id": s.document_id,
            "document_name": s.document.document_name if s.document else "",
            "status": s.status,
            "comment": s.comment or "",
            "submitter_comment": s.submitter_comment or "",
            "submitted_at": s.submitted_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "submission_number": _submission_number(db, s),
        }
        for s in submissions
    ]


@router.get("/pending-reviews")
def pending_reviews(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin: get the current submission cycle of each document, filtered by
    jurisdiction (superadmin sees all). Older, already-corrected rejection
    cycles are historical and are not mixed into this list — see
    /repository/{doc_id}/events or /drafts/my-submissions for the full history."""
    query = db.query(DraftSubmission)

    # Non-superadmin admins only see submissions from users in their jurisdiction
    if admin.role != "superadmin" and admin.jurisdiccion:
        query = query.join(DraftSubmission.submitter).filter(
            User.jurisdiccion == admin.jurisdiccion
        )

    all_submissions = query.order_by(DraftSubmission.submitted_at.asc()).all()

    # Keep only the latest submission cycle per document.
    latest_by_doc = {}
    for s in all_submissions:
        latest_by_doc[s.document_id] = s
    submissions = sorted(latest_by_doc.values(), key=lambda s: s.submitted_at, reverse=True)

    results = []
    for s in submissions:
        field_values = {}
        if s.document and s.document.field_values_json:
            try:
                field_values = json.loads(s.document.field_values_json)
            except (json.JSONDecodeError, TypeError):
                pass
        results.append({
            "id": s.id,
            "document_id": s.document_id,
            "document_name": s.document.document_name if s.document else "",
            "document_type": s.document.document_type if s.document else "",
            "docx_filename": s.document.docx_filename if s.document else "",
            "jurisdiccion": field_values.get("jurisdiccion", ""),
            "submitter_name": s.submitter.name if s.submitter else "",
            "submitter_email": s.submitter.email if s.submitter else "",
            "field_values": field_values,
            "status": s.status,
            "comment": s.comment or "",
            "submitter_comment": s.submitter_comment or "",
            "submitted_at": s.submitted_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "reviewer_name": s.reviewer.name if s.reviewer else None,
            "submission_number": _submission_number(db, s),
        })
    return results


@router.get("/reviewed")
def reviewed_submissions(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin: full history of already-reviewed (aprobado/rechazado) submissions."""
    query = db.query(DraftSubmission)
    if admin.role != "superadmin" and admin.jurisdiccion:
        query = query.join(DraftSubmission.submitter).filter(
            User.jurisdiccion == admin.jurisdiccion
        )
    submissions = (
        query.filter(DraftSubmission.status.in_(["aprobado", "rechazado"]))
        .order_by(DraftSubmission.reviewed_at.desc())
        .all()
    )
    results = []
    for s in submissions:
        field_values = {}
        if s.document and s.document.field_values_json:
            try:
                field_values = json.loads(s.document.field_values_json)
            except (json.JSONDecodeError, TypeError):
                pass
        results.append({
            "id": s.id,
            "document_id": s.document_id,
            "document_name": s.document.document_name if s.document else "",
            "document_type": s.document.document_type if s.document else "",
            "docx_filename": s.document.docx_filename if s.document else "",
            "jurisdiccion": field_values.get("jurisdiccion", ""),
            "submitter_name": s.submitter.name if s.submitter else "",
            "submitter_email": s.submitter.email if s.submitter else "",
            "status": s.status,
            "comment": s.comment or "",
            "submitted_at": s.submitted_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "reviewer_name": s.reviewer.name if s.reviewer else None,
            "reviewer_role": s.reviewer.role if s.reviewer else None,
            "submission_number": _submission_number(db, s),
        })
    return results


@router.put("/{submission_id}/review")
def review_draft(
    submission_id: int,
    request: ReviewDraftRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin reviews (approves or rejects) a draft submission."""
    if request.status not in ("aprobado", "rechazado"):
        raise HTTPException(status_code=400, detail="Estado inválido. Use 'aprobado' o 'rechazado'")

    submission = db.query(DraftSubmission).filter(DraftSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    if submission.status != "pendiente":
        raise HTTPException(status_code=400, detail="Este envío ya fue revisado")

    submission.status = request.status
    submission.comment = request.comment
    submission.reviewed_by = admin.id
    submission.reviewed_at = datetime.now(CHILE_TZ)

    # Track event — include cycle number for rejected documents
    if request.status == "rechazado":
        rejection_count = (
            db.query(DocumentEvent)
            .filter(DocumentEvent.document_id == submission.document_id, DocumentEvent.action == "rechazado")
            .count()
        ) + 1
        event_detail = f"Rechazo #{rejection_count} por {admin.name}"
    else:
        event_detail = f"Documento aprobado por {admin.name}"
    if request.comment:
        event_detail += f". Comentario: {request.comment}"
    event = DocumentEvent(
        document_id=submission.document_id,
        action=request.status,
        actor_id=admin.id,
        actor_role=admin.role,
        detail=event_detail,
    )
    db.add(event)

    # If approved, add validation footer and strip highlights so final file is clean
    if request.status == "aprobado" and submission.document:
        docx_path = os.path.join(GENERATED_DIR, submission.document.docx_filename)
        if os.path.exists(docx_path):
            try:
                add_validation_footer(docx_path, admin.name)
                pdf_path = docx_path.rsplit(".", 1)[0] + ".pdf"
                if os.path.exists(pdf_path):
                    os.remove(pdf_path)
            except Exception:
                pass  # Don't fail the approval if footer can't be added

    # Notify the submitter
    status_label = "aprobado" if request.status == "aprobado" else "rechazado"
    doc_name = submission.document.document_name if submission.document else "documento"
    notification = Notification(
        user_id=submission.submitted_by,
        message=f"Su borrador \"{doc_name}\" ha sido {status_label} por {admin.name}."
        + (f" Comentario: {request.comment}" if request.comment else ""),
        link="/repository",
    )
    db.add(notification)

    if submission.submitter:
        if request.status == "aprobado":
            send_approval_email(submission.submitter.email, submission.submitter.name, doc_name)
        else:
            send_rejection_email(submission.submitter.email, submission.submitter.name, doc_name, request.comment)

    db.commit()
    return {"message": f"Borrador {status_label} exitosamente"}


@router.get("/notifications")
def get_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get notifications for the current user."""
    notifs = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": n.id,
            "message": n.message,
            "link": n.link,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifs
    ]


@router.put("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a notification as read."""
    notif = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == user.id)
        .first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    notif.is_read = 1
    db.commit()
    return {"message": "Notificación marcada como leída"}


@router.put("/notifications/read-all")
def mark_all_notifications_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark all notifications as read."""
    db.query(Notification).filter(
        Notification.user_id == user.id, Notification.is_read == 0
    ).update({"is_read": 1})
    db.commit()
    return {"message": "Todas las notificaciones marcadas como leídas"}


@router.post("/{submission_id}/reupload")
async def reupload_document(
    submission_id: int,
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin re-uploads an edited Word document for a submission."""
    submission = db.query(DraftSubmission).filter(DraftSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    if not submission.document:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    if not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos .docx")

    docx_path = os.path.join(GENERATED_DIR, submission.document.docx_filename)
    # Overwrite the existing file
    content = await file.read()
    with open(docx_path, "wb") as f:
        f.write(content)

    # Remove cached PDF if exists
    pdf_path = docx_path.rsplit(".", 1)[0] + ".pdf"
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    # Track event
    event = DocumentEvent(
        document_id=submission.document_id,
        action="resubido",
        actor_id=admin.id,
        actor_role=admin.role,
        detail=f"Documento resubido por {admin.name}",
    )
    db.add(event)
    db.commit()

    return {"message": "Documento actualizado exitosamente"}


@router.post("/{doc_id}/resubmit")
async def resubmit_corrected(
    doc_id: int,
    file: UploadFile = File(...),
    comment: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Operativo uploads a corrected document and resubmits for review."""
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == doc_id, UserDocument.user_id == user.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    rejected_submission = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.document_id == doc.id, DraftSubmission.status == "rechazado")
        .order_by(DraftSubmission.submitted_at.desc())
        .first()
    )
    if not rejected_submission:
        raise HTTPException(status_code=400, detail="Este documento no tiene un rechazo pendiente de corrección")

    if not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos .docx")

    docx_path = os.path.join(GENERATED_DIR, doc.docx_filename)
    content = await file.read()
    with open(docx_path, "wb") as f:
        f.write(content)

    pdf_path = docx_path.rsplit(".", 1)[0] + ".pdf"
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    submitter_comment = (comment or "").strip()
    # A new submission cycle is created (rather than reusing the rejected one)
    # so the rejection's comment and reviewer stay intact as history.
    db.add(DraftSubmission(
        document_id=doc.id,
        submitted_by=user.id,
        status="pendiente",
        submitter_comment=submitter_comment,
    ))

    correction_count = (
        db.query(DocumentEvent)
        .filter(DocumentEvent.document_id == doc.id, DocumentEvent.action == "corregido")
        .count()
    ) + 1
    event_detail = f"Corrección #{correction_count}: documento corregido y reenviado para validación"
    if submitter_comment:
        event_detail += f". Comentario del solicitante: {submitter_comment}"
    event = DocumentEvent(
        document_id=doc.id,
        action="corregido",
        actor_id=user.id,
        actor_role=user.role,
        detail=event_detail,
    )
    db.add(event)

    admins = db.query(User).filter(User.role.in_(["admin", "superadmin"]), User.is_active == 1).all()
    for admin in admins:
        notification = Notification(
            user_id=admin.id,
            message=f"{user.name} ha corregido y reenviado el borrador \"{doc.document_name}\" para revisión.",
            link="/admin/reviews",
        )
        db.add(notification)
        send_draft_notification_email(
            to_email=admin.email,
            admin_name=admin.name,
            submitter_name=user.name,
            document_name=doc.document_name,
        )

    db.commit()
    return {"message": "Documento corregido y reenviado para revisión"}


@router.get("/document-fields/{doc_id}")
def get_document_fields(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the stored field values for a document (for editing)."""
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == doc_id, UserDocument.user_id == user.id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    field_values = {}
    if doc.field_values_json:
        try:
            field_values = json.loads(doc.field_values_json)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "document_id": doc.id,
        "document_type": doc.document_type,
        "template_id": doc.template_id_ref,
        "template_name": doc.template_name,
        "field_values": field_values,
    }


@router.get("/preview-pdf/{doc_id}")
def preview_document_pdf(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a read-only PDF preview. Approved documents are shown clean; others show Borrador footer."""
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

    docx_path = os.path.join(GENERATED_DIR, doc.docx_filename)
    if not os.path.exists(docx_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    # Check if this document is already approved
    submission = (
        db.query(DraftSubmission)
        .filter(DraftSubmission.document_id == doc.id, DraftSubmission.status == "aprobado")
        .first()
    )

    if submission:
        # Document is approved: convert the clean approved docx directly, no pending footer
        pdf_path = convert_to_pdf(docx_path)
        if not pdf_path:
            raise HTTPException(status_code=500, detail="No se pudo generar la vista previa PDF")
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"},
        )

    field_values = {}
    if doc.field_values_json:
        try:
            field_values = json.loads(doc.field_values_json)
        except (json.JSONDecodeError, TypeError):
            pass

    template_path = None
    if doc.template_id_ref:
        from ..models import Template
        tmpl = db.query(Template).filter(Template.id == doc.template_id_ref).first()
        if tmpl:
            resolved = _resolve_template_path(tmpl.file_path)
            if os.path.exists(resolved):
                template_path = resolved

    preview_docx = os.path.join(GENERATED_DIR, f"_preview_{doc.docx_filename}")
    try:
        add_pending_footer(docx_path, preview_docx, field_values=field_values, template_path=template_path)

        pdf_path = convert_to_pdf(preview_docx)
        if not pdf_path:
            raise HTTPException(status_code=500, detail="No se pudo generar la vista previa PDF")

        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"},
        )
    finally:
        if os.path.exists(preview_docx):
            os.remove(preview_docx)
