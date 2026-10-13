import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Template, User, UserDocument, DocumentEvent, DraftSubmission, InsumoDocumento, Notification, DocumentoValidador
from ..schemas import DocumentGenerateRequest
from ..services.document_generator import generate_document, convert_to_pdf, add_draft_marker, add_validation_footer, GENERATED_DIR
from ..services.text_review import review_field_values
from ..services.auth import get_current_user
from ..services.antecedentes import validate_validador_file, bundle_for_document
from ..services.email_service import send_draft_notification_email

router = APIRouter(prefix="/api/documents", tags=["documents"])

_TEMPLATES_DIR = os.environ.get(
    "TEMPLATES_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "templates"),
)


def _resolve_template_path(stored: str) -> str:
    """Resolve stored file_path to absolute path (supports legacy absolute paths)."""
    if os.path.isabs(stored):
        return stored
    return os.path.join(_TEMPLATES_DIR, stored)


def _safe_file_path(filename: str) -> str:
    """Validate filename and return safe absolute path within GENERATED_DIR. Raises 400 on traversal."""
    if not filename or any(c in filename for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    path = os.path.abspath(os.path.join(GENERATED_DIR, filename))
    if not path.startswith(os.path.abspath(GENERATED_DIR)):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    return path


@router.post("/generate")
def generate(
    request: DocumentGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")

    if not os.path.exists(_resolve_template_path(template.file_path)):
        raise HTTPException(
            status_code=500, detail="Archivo de plantilla no encontrado en el servidor"
        )

    template_clean = template.name.replace(" ", "_")
    output_name = f"{uuid.uuid4().hex[:10]}_{template_clean}"

    reviewed_values = review_field_values(request.field_values)

    is_admin = user.role in ("admin", "superadmin")

    try:
        docx_path = generate_document(_resolve_template_path(template.file_path), reviewed_values, output_name)
        if is_admin:
            # Admin/superadmin: apply validation footer directly (auto-approved)
            try:
                add_validation_footer(docx_path, user.name)
            except Exception:
                pass
        else:
            try:
                add_draft_marker(docx_path)
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error al generar documento: {str(e)}"
        )

    docx_filename = os.path.basename(docx_path)

    user_doc = UserDocument(
        user_id=user.id,
        document_name=template.name,
        document_type="base",
        template_name=template.name,
        category_name=template.category.name if template.category else "",
        docx_filename=docx_filename,
        field_values_json=json.dumps(request.field_values, ensure_ascii=False),
        template_id_ref=template.id,
    )
    db.add(user_doc)
    db.flush()

    db.add(DocumentEvent(
        document_id=user_doc.id,
        action="creado",
        actor_id=user.id,
        actor_role=user.role,
        detail=f"Documento generado desde plantilla: {template.name}",
    ))

    if is_admin:
        # Auto-approve: create submission already approved, no review cycle needed
        from ..models import DraftSubmission
        from datetime import datetime, timezone, timedelta
        from zoneinfo import ZoneInfo
        try:
            _tz = ZoneInfo("America/Santiago")
        except KeyError:
            _tz = timezone(timedelta(hours=-4))

        submission = DraftSubmission(
            document_id=user_doc.id,
            submitted_by=user.id,
            status="aprobado",
            submitter_comment="Generado y aprobado automáticamente por administrador.",
            comment="",
            reviewed_by=user.id,
            reviewed_at=datetime.now(_tz).replace(tzinfo=None),
        )
        db.add(submission)
        db.add(DocumentEvent(
            document_id=user_doc.id,
            action="aprobado",
            actor_id=user.id,
            actor_role=user.role,
            detail=f"Documento aprobado automáticamente — generado por {user.name}",
        ))

    if request.insumo_ids:
        db.query(InsumoDocumento).filter(
            InsumoDocumento.id.in_(request.insumo_ids),
            InsumoDocumento.uploaded_by == user.id,
            InsumoDocumento.document_id.is_(None),
        ).update({"document_id": user_doc.id}, synchronize_session=False)

    db.commit()
    db.refresh(user_doc)

    return {
        "message": "Documento generado exitosamente",
        "docx_filename": docx_filename,
        "document_id": user_doc.id,
        "auto_approved": is_admin,
    }


@router.put("/regenerate/{doc_id}")
def regenerate_document_corrected(
    doc_id: int,
    request: DocumentGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Regenerate a rejected document and reset submission to pendiente."""
    doc = db.query(UserDocument).filter(UserDocument.id == doc_id, UserDocument.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    rejected_submission = db.query(DraftSubmission).filter(
        DraftSubmission.document_id == doc_id,
        DraftSubmission.status == "rechazado",
    ).order_by(DraftSubmission.submitted_at.desc()).first()
    if not rejected_submission:
        raise HTTPException(status_code=400, detail="Este documento no tiene un rechazo pendiente de corrección")

    template = db.query(Template).filter(Template.id == request.template_id).first()
    if not template or not os.path.exists(_resolve_template_path(template.file_path)):
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")

    reviewed_values = review_field_values(request.field_values)

    output_name = doc.docx_filename.replace(".docx", "")
    try:
        regen_path = generate_document(_resolve_template_path(template.file_path), reviewed_values, output_name)
        try:
            add_draft_marker(regen_path)
        except Exception:
            pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al regenerar documento: {str(e)}")

    pdf_path = os.path.join(GENERATED_DIR, output_name + ".pdf")
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    # A new submission cycle is created (rather than reusing the rejected one)
    # so the rejection's comment and reviewer stay intact as history.
    # La declaración de carpeta y antecedentes (mejora M3) del ciclo rechazado
    # se mantiene en el nuevo ciclo de revisión.
    _bundle = bundle_for_document(db, doc.id)
    new_submission = DraftSubmission(
        document_id=doc.id,
        submitted_by=user.id,
        status="pendiente",
        carpeta_url=rejected_submission.carpeta_url or ((_bundle.carpeta_url or "") if _bundle else ""),
        antecedentes_confirmados=rejected_submission.antecedentes_confirmados or 0,
    )
    db.add(new_submission)

    doc.field_values_json = json.dumps(request.field_values, ensure_ascii=False)

    # Count previous correction cycles for traceability
    correction_count = (
        db.query(DocumentEvent)
        .filter(DocumentEvent.document_id == doc.id, DocumentEvent.action == "corregido")
        .count()
    ) + 1

    db.add(DocumentEvent(
        document_id=doc.id,
        action="corregido",
        actor_id=user.id,
        actor_role=user.role,
        detail=f"Corrección #{correction_count}: documento corregido y reenviado para validación",
    ))

    if request.insumo_ids:
        db.query(InsumoDocumento).filter(
            InsumoDocumento.id.in_(request.insumo_ids),
            InsumoDocumento.uploaded_by == user.id,
            InsumoDocumento.document_id.is_(None),
        ).update({"document_id": doc.id}, synchronize_session=False)

    db.commit()

    return {"message": "Documento corregido exitosamente", "document_id": doc.id, "docx_filename": doc.docx_filename}


VALIDADORES_DIR = os.path.join(GENERATED_DIR, "validadores")


@router.post("/modify-pending/{doc_id}")
def modify_pending_document(
    doc_id: int,
    template_id: int = Form(...),
    field_values_json: str = Form(...),
    motivo: str = Form(...),
    validador: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mejora M4: permite modificar un contrato ya enviado como borrador
    (pendiente de revisión) cuando se requiere un nuevo antecedente legal, por
    ejemplo el cambio de nombre de un representante legal. Todo cambio exige
    un documento validador (escritura pública, acta u otro) y un motivo, que
    quedan registrados y visibles para el revisor."""
    doc = db.query(UserDocument).filter(UserDocument.id == doc_id, UserDocument.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    submission = doc.latest_submission
    if not submission or submission.status != "pendiente":
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden modificar con documento validador los contratos enviados y pendientes de revisión",
        )

    motivo = (motivo or "").strip()
    if len(motivo) < 10:
        raise HTTPException(status_code=400, detail="Indique el motivo de la modificación (mínimo 10 caracteres)")

    try:
        field_values = json.loads(field_values_json)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="Valores de campos inválidos")
    if not isinstance(field_values, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in field_values.items()
    ):
        raise HTTPException(status_code=400, detail="Valores de campos inválidos")

    template = db.query(Template).filter(Template.id == template_id).first()
    if not template or not os.path.exists(_resolve_template_path(template.file_path)):
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    if doc.template_id_ref and doc.template_id_ref != template.id:
        raise HTTPException(status_code=400, detail="La plantilla no corresponde al documento")

    content = validador.file.read()
    ext = validate_validador_file(validador.filename, content)

    os.makedirs(VALIDADORES_DIR, exist_ok=True)
    original_name = os.path.basename(validador.filename or f"validador{ext}")
    stored_name = f"{uuid.uuid4().hex[:12]}{ext}"
    stored_path = os.path.join(VALIDADORES_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(content)

    reviewed_values = review_field_values(field_values)
    output_name = doc.docx_filename.replace(".docx", "")
    try:
        regen_path = generate_document(_resolve_template_path(template.file_path), reviewed_values, output_name)
        try:
            add_draft_marker(regen_path)
        except Exception:
            pass
    except Exception as e:
        if os.path.exists(stored_path):
            os.remove(stored_path)
        raise HTTPException(status_code=500, detail=f"Error al regenerar documento: {str(e)}")

    pdf_path = os.path.join(GENERATED_DIR, output_name + ".pdf")
    if os.path.exists(pdf_path):
        os.remove(pdf_path)

    doc.field_values_json = json.dumps(field_values, ensure_ascii=False)
    db.add(DocumentoValidador(
        document_id=doc.id,
        submission_id=submission.id,
        uploaded_by=user.id,
        motivo=motivo,
        filename=original_name,
        stored_path=stored_name,
    ))
    db.add(DocumentEvent(
        document_id=doc.id,
        action="modificado",
        actor_id=user.id,
        actor_role=user.role,
        detail=f"Contrato modificado durante la revisión con documento validador \"{original_name}\". Motivo: {motivo}",
    ))

    admins = db.query(User).filter(User.role.in_(["admin", "superadmin"]), User.is_active == 1).all()
    for admin in admins:
        db.add(Notification(
            user_id=admin.id,
            message=f"{user.name} modificó el borrador \"{doc.document_name}\" con un documento validador. Motivo: {motivo}",
            link="/admin/reviews",
        ))
        send_draft_notification_email(
            to_email=admin.email,
            admin_name=admin.name,
            submitter_name=user.name,
            document_name=doc.document_name,
        )

    db.commit()
    return {"message": "Contrato modificado con documento validador", "document_id": doc.id, "docx_filename": doc.docx_filename}


@router.get("/validadores/{validador_id}")
def download_validador(
    validador_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Descarga de un documento validador: solo el autor del documento y los
    perfiles revisores (admin y superadmin)."""
    validador = db.query(DocumentoValidador).filter(DocumentoValidador.id == validador_id).first()
    if not validador:
        raise HTTPException(status_code=404, detail="Documento validador no encontrado")
    owner_id = validador.document.user_id if validador.document else None
    if user.role not in ("admin", "superadmin") and user.id != owner_id:
        raise HTTPException(status_code=403, detail="No tiene permiso para descargar este documento")

    stored = validador.stored_path
    if not stored or any(c in stored for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    path = os.path.abspath(os.path.join(VALIDADORES_DIR, stored))
    if not path.startswith(os.path.abspath(VALIDADORES_DIR)) or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(path, filename=validador.filename)


@router.get("/download/{filename}")
def download_docx(filename: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    file_path = _safe_file_path(filename)
    if user.role not in ("admin", "superadmin"):
        doc = db.query(UserDocument).filter(
            UserDocument.docx_filename == filename,
            UserDocument.user_id == user.id,
        ).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    return FileResponse(
        file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )


@router.get("/download-pdf/{filename}")
def download_pdf(filename: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docx_path = _safe_file_path(filename)
    if user.role not in ("admin", "superadmin"):
        doc = db.query(UserDocument).filter(
            UserDocument.docx_filename == filename,
            UserDocument.user_id == user.id,
        ).first()
        if not doc:
            raise HTTPException(status_code=404, detail="Archivo no encontrado")
    if not os.path.exists(docx_path):
        raise HTTPException(status_code=404, detail="Archivo DOCX no encontrado")

    pdf_path = convert_to_pdf(docx_path)
    if not pdf_path:
        raise HTTPException(
            status_code=500,
            detail="No se pudo convertir a PDF. Asegúrese de que LibreOffice esté instalado.",
        )

    pdf_filename = os.path.basename(pdf_path)
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=pdf_filename,
    )
