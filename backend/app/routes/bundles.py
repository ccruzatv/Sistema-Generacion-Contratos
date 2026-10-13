import io
import json
import os
import re
import zipfile
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, DocumentBundle, BundleItem, Template, Category, UserDocument
from ..services.auth import get_current_user
from ..services.document_generator import GENERATED_DIR, convert_to_pdf
from ..services.antecedentes import normalize_sgf_id, normalize_carpeta_url

router = APIRouter(prefix="/api/bundles", tags=["bundles"])


def _safe_file_path(filename: str) -> str:
    if not filename or any(c in filename for c in ("/", "\\", "..")):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    path = os.path.abspath(os.path.join(GENERATED_DIR, filename))
    if not path.startswith(os.path.abspath(GENERATED_DIR)):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    return path


def _is_effectively_completed(item) -> bool:
    """An item generated but currently rejected still needs correction, so it
    should not count as completed until it is regenerated and resubmitted."""
    if not item.is_completed:
        return False
    doc = item.document
    if doc is not None and doc.latest_submission and doc.latest_submission.status == "rechazado":
        return False
    return True


class CreateBundleRequest(BaseModel):
    category_id: int
    jurisdiccion: str = ""
    nombre_licitacion: str = ""
    sgf_id: str = ""
    carpeta_url: str = ""


class UpdateAntecedentesRequest(BaseModel):
    sgf_id: str = ""
    carpeta_url: str = ""


class LinkItemRequest(BaseModel):
    document_id: int


class SaveDraftRequest(BaseModel):
    values: dict[str, str]


@router.post("/")
def create_bundle(
    request: CreateBundleRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bidding_type = db.query(Category).filter(
        Category.id == request.category_id,
        Category.parent_id.is_(None),
    ).first()
    if not bidding_type:
        raise HTTPException(status_code=404, detail="Tipo de contrato no encontrado")

    sgf_id = normalize_sgf_id(request.sgf_id)
    carpeta_url = normalize_carpeta_url(request.carpeta_url)

    last = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.user_id == user.id)
        .order_by(DocumentBundle.correlativo.desc())
        .first()
    )
    correlativo = (last.correlativo + 1) if last else 1

    bundle = DocumentBundle(
        correlativo=correlativo,
        user_id=user.id,
        category_id=bidding_type.id,
        category_name=bidding_type.name,
        jurisdiccion=request.jurisdiccion,
        nombre_licitacion=request.nombre_licitacion,
        sgf_id=sgf_id,
        carpeta_url=carpeta_url,
    )
    db.add(bundle)
    db.flush()

    subcategories = (
        db.query(Category)
        .filter(Category.parent_id == bidding_type.id)
        .order_by(Category.order)
        .all()
    )

    item_order = 0
    for sub in subcategories:
        is_optional = sub.name == "Anexos"
        templates = (
            db.query(Template)
            .filter(Template.category_id == sub.id)
            .order_by(Template.id)
            .all()
        )
        if templates:
            for tmpl in templates:
                item = BundleItem(
                    bundle_id=bundle.id,
                    template_id=tmpl.id,
                    template_name=f"{sub.name} — {tmpl.name}",
                    item_order=item_order,
                    is_optional=is_optional,
                )
                db.add(item)
                item_order += 1
        elif not is_optional:
            # Placeholder for a required subcategory sin plantilla aún.
            item = BundleItem(
                bundle_id=bundle.id,
                template_name=sub.name,
                item_order=item_order,
            )
            db.add(item)
            item_order += 1

    db.commit()
    db.refresh(bundle)

    return {
        "id": bundle.id,
        "correlativo": bundle.correlativo,
        "category_name": bundle.category_name,
        "item_count": item_order,
    }


@router.get("/")
def list_bundles(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bundles = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.user_id == user.id)
        .order_by(DocumentBundle.correlativo.desc())
        .all()
    )

    result = []
    for b in bundles:
        main_items = [item for item in b.items if not item.is_optional]
        total = len(main_items)
        completed = sum(1 for item in main_items if _is_effectively_completed(item))
        result.append({
            "id": b.id,
            "correlativo": b.correlativo,
            "category_name": b.category_name,
            "jurisdiccion": b.jurisdiccion,
            "nombre_licitacion": b.nombre_licitacion,
            "sgf_id": b.sgf_id or "",
            "carpeta_url": b.carpeta_url or "",
            "total_items": total,
            "completed_items": completed,
            "created_at": b.created_at.isoformat(),
        })
    return result


@router.get("/{bundle_id}")
def get_bundle(
    bundle_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    items = []
    for item in bundle.items:
        doc = item.document
        draft = {}
        if item.draft_values:
            try:
                draft = json.loads(item.draft_values)
            except (json.JSONDecodeError, TypeError):
                pass
        submission_status = (
            doc.latest_submission.status if doc is not None and doc.latest_submission is not None else None
        )
        is_approved = submission_status == "aprobado"
        has_fields = bool(item.template and item.template.fields)
        items.append({
            "id": item.id,
            "template_id": item.template_id,
            "template_name": item.template_name,
            "is_completed": item.is_completed,
            "is_approved": is_approved,
            "submission_status": submission_status,
            "is_optional": item.is_optional,
            "has_fields": has_fields,
            "item_order": item.item_order,
            "document_id": item.document_id,
            "docx_filename": doc.docx_filename if doc else None,
            "draft_values": draft,
        })

    return {
        "id": bundle.id,
        "correlativo": bundle.correlativo,
        "category_id": bundle.category_id,
        "category_name": bundle.category_name,
        "jurisdiccion": bundle.jurisdiccion,
        "nombre_licitacion": bundle.nombre_licitacion,
        "sgf_id": bundle.sgf_id or "",
        "carpeta_url": bundle.carpeta_url or "",
        "created_at": bundle.created_at.isoformat(),
        "items": items,
    }


@router.put("/{bundle_id}/antecedentes")
def update_bundle_antecedentes(
    bundle_id: int,
    request: UpdateAntecedentesRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Registra o actualiza el ID de SGF y el enlace a la carpeta virtual de
    antecedentes del expediente (mejoras M1 y M2)."""
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    bundle.sgf_id = normalize_sgf_id(request.sgf_id)
    bundle.carpeta_url = normalize_carpeta_url(request.carpeta_url)
    db.commit()

    return {
        "message": "Antecedentes del expediente actualizados",
        "sgf_id": bundle.sgf_id,
        "carpeta_url": bundle.carpeta_url,
    }


@router.put("/{bundle_id}/items/{item_id}/draft")
def save_item_draft(
    bundle_id: int,
    item_id: int,
    request: SaveDraftRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    item = db.query(BundleItem).filter(
        BundleItem.id == item_id,
        BundleItem.bundle_id == bundle_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")

    item.draft_values = json.dumps(request.values, ensure_ascii=False)
    db.commit()

    return {"message": "Borrador guardado"}


@router.post("/{bundle_id}/items/{item_id}/link")
def link_bundle_item(
    bundle_id: int,
    item_id: int,
    request: LinkItemRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    item = db.query(BundleItem).filter(
        BundleItem.id == item_id,
        BundleItem.bundle_id == bundle_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")

    doc = db.query(UserDocument).filter(
        UserDocument.id == request.document_id,
        UserDocument.user_id == user.id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Un contrato pendiente de revisión solo puede modificarse con documento
    # validador (mejora M4); no se permite reemplazarlo por otro documento.
    current = item.document
    if (
        current is not None
        and current.id != doc.id
        and current.latest_submission is not None
        and current.latest_submission.status == "pendiente"
    ):
        raise HTTPException(
            status_code=400,
            detail="El documento de este ítem está pendiente de revisión; para modificarlo use la opción con documento validador",
        )

    item.document_id = request.document_id
    item.is_completed = True
    item.draft_values = ""
    db.commit()

    return {"message": "Ítem actualizado"}


def _get_approved_items(bundle):
    return [
        item for item in bundle.items
        if item.document and item.document.latest_submission
        and item.document.latest_submission.status == "aprobado"
    ]


def _safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|—–]', "_", name).strip("_")


def _entry_name(template_name: str, jurisdiccion: str, ext: str) -> str:
    base = _safe_name(template_name)
    jur = jurisdiccion.replace(" ", "_")
    return f"{base}_{jur}{ext}" if jur else f"{base}{ext}"


@router.get("/{bundle_id}/download-all")
def download_all_pdf(
    bundle_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """ZIP con todos los documentos aprobados en PDF."""
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    approved = _get_approved_items(bundle)
    if not approved:
        raise HTTPException(status_code=400, detail="No hay documentos aprobados para descargar")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in approved:
            docx_path = _safe_file_path(item.document.docx_filename)
            if not os.path.exists(docx_path):
                continue
            pdf_path = docx_path.replace(".docx", ".pdf")
            # Generate PDF on-demand if it doesn't exist yet
            if not os.path.exists(pdf_path):
                pdf_path = convert_to_pdf(docx_path) or ""
            if pdf_path and os.path.exists(pdf_path):
                zf.write(pdf_path, _entry_name(item.template_name, bundle.jurisdiccion or "", ".pdf"))

    zip_buffer.seek(0)
    filename = f"Expediente_{bundle.correlativo}_PDF.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{bundle_id}/download-all-docx")
def download_all_docx(
    bundle_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """ZIP con todos los documentos aprobados en Word."""
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    approved = _get_approved_items(bundle)
    if not approved:
        raise HTTPException(status_code=400, detail="No hay documentos aprobados para descargar")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in approved:
            docx_path = _safe_file_path(item.document.docx_filename)
            if os.path.exists(docx_path):
                zf.write(docx_path, _entry_name(item.template_name, bundle.jurisdiccion or "", ".docx"))

    zip_buffer.seek(0)
    filename = f"Expediente_{bundle.correlativo}_Word.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.delete("/{bundle_id}")
def delete_bundle(
    bundle_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bundle = (
        db.query(DocumentBundle)
        .filter(DocumentBundle.id == bundle_id, DocumentBundle.user_id == user.id)
        .first()
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Expediente no encontrado")

    db.delete(bundle)
    db.commit()
    return {"message": "Expediente eliminado"}
