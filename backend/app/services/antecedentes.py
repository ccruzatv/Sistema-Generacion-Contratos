"""Reglas de antecedentes del contrato.

Mejoras incorporadas a partir de las observaciones del Departamento Jurídico
en la reunión de revisión del 02.10.2026:

- M1: ID de SGF asociado a cada contrato (expediente).
- M2: enlace a la carpeta virtual de antecedentes del contrato.
- M3: declaración de carpeta y antecedentes al enviar un borrador a revisión.
- M4: documento validador obligatorio para modificar un contrato ya enviado.
"""
import os
import re
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import BundleItem, DocumentBundle, DocumentoValidador

MAX_URL_LENGTH = 1000
MAX_SGF_LENGTH = 50
MAX_VALIDADOR_SIZE = 100 * 1024 * 1024  # 100 MB, mismo límite que las plantillas

_SGF_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_/.]*$")

# Extensión permitida -> firma binaria esperada al inicio del archivo.
_VALIDADOR_SIGNATURES = {
    ".pdf": (b"%PDF",),
    ".docx": (b"PK\x03\x04",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
}


def normalize_sgf_id(value: Optional[str]) -> str:
    """Valida y normaliza el ID de SGF. Vacío está permitido (dato opcional)."""
    sgf = (value or "").strip()
    if not sgf:
        return ""
    if len(sgf) > MAX_SGF_LENGTH or not _SGF_PATTERN.match(sgf):
        raise HTTPException(
            status_code=400,
            detail="El ID de SGF solo admite letras, números, guion, guion bajo, punto o barra (máximo 50 caracteres)",
        )
    return sgf


def normalize_carpeta_url(value: Optional[str]) -> str:
    """Valida el enlace a la carpeta virtual de antecedentes. Vacío está permitido."""
    url = (value or "").strip()
    if not url:
        return ""
    if len(url) > MAX_URL_LENGTH:
        raise HTTPException(status_code=400, detail="El enlace a la carpeta de antecedentes es demasiado largo")
    if not url.lower().startswith("https://") or any(c.isspace() for c in url):
        raise HTTPException(
            status_code=400,
            detail="El enlace a la carpeta de antecedentes debe ser una dirección https:// válida",
        )
    return url


def bundle_for_document(db: Session, document_id: int) -> Optional[DocumentBundle]:
    """Expediente al que está vinculado un documento, si existe."""
    item = db.query(BundleItem).filter(BundleItem.document_id == document_id).first()
    return item.bundle if item else None


def validate_validador_file(filename: str, content: bytes) -> str:
    """Valida extensión, tamaño y firma binaria del documento validador.
    Retorna la extensión en minúsculas."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in _VALIDADOR_SIGNATURES:
        raise HTTPException(
            status_code=400,
            detail="El documento validador debe ser PDF, Word (.docx), PNG o JPG",
        )
    if not content:
        raise HTTPException(status_code=400, detail="El documento validador está vacío")
    if len(content) > MAX_VALIDADOR_SIZE:
        raise HTTPException(status_code=400, detail="El documento validador supera el tamaño máximo permitido (100 MB)")
    if not any(content.startswith(sig) for sig in _VALIDADOR_SIGNATURES[ext]):
        raise HTTPException(status_code=400, detail="El contenido del documento validador no corresponde a su extensión")
    return ext


def validadores_payload(db: Session, document_id: int) -> list[dict]:
    """Lista de documentos validadores de un documento, para mostrar al revisor."""
    rows = (
        db.query(DocumentoValidador)
        .filter(DocumentoValidador.document_id == document_id)
        .order_by(DocumentoValidador.created_at.asc())
        .all()
    )
    return [
        {
            "id": v.id,
            "filename": v.filename,
            "motivo": v.motivo or "",
            "uploaded_by": v.uploader.name if v.uploader else "",
            "created_at": v.created_at.isoformat() if v.created_at else None,
        }
        for v in rows
    ]
