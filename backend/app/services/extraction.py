"""Extraccion de datos de insumo desde documentos de respaldo (PDF/Word).

Enfoque: texto plano del documento + reglas de patrones (regex) por campo
canonico. EXTRACTION_RULES es el punto de extension: cada campo tiene una
lista de patrones, evaluados en orden hasta encontrar la primera coincidencia.
Para agregar o ajustar una regla de negocio, basta con sumar/editar patrones
aqui — no requiere tocar el resto del pipeline.
"""
import re
import os
from docx import Document
from pypdf import PdfReader

# Campos canonicos que el sistema intenta extraer de los documentos de insumo.
CANONICAL_FIELDS = [
    "precio",
    "vigencia",
    "garantia",
    "renovacion",
    "termino_anticipado",
    "multas",
]

_VALOR = r"\$?\s*[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:UF|UTM|CLP|pesos)?"

EXTRACTION_RULES: dict[str, list[re.Pattern]] = {
    "precio": [
        re.compile(rf"(?:precio|monto|valor)\s+(?:total|del\s+contrato|mensual|neto)?\s*[:\-]?\s*({_VALOR})", re.IGNORECASE),
        re.compile(rf"(?:precio|monto|valor)\s*[:\-]\s*({_VALOR})", re.IGNORECASE),
    ],
    "vigencia": [
        re.compile(r"vigencia\s*(?:del\s+contrato)?\s*[:\-]?\s*([^\n\.]{3,100})", re.IGNORECASE),
        re.compile(r"plazo\s+de\s+(?:duraci[oó]n|ejecuci[oó]n)?\s*[:\-]?\s*([^\n\.]{3,100})", re.IGNORECASE),
    ],
    "garantia": [
        re.compile(r"garant[ií]a\s*(?:de\s+fiel\s+cumplimiento)?\s*[:\-]?\s*([^\n\.]{3,120})", re.IGNORECASE),
    ],
    "renovacion": [
        re.compile(r"renovaci[oó]n\s*(?:autom[aá]tica)?\s*[:\-]?\s*([^\n\.]{3,120})", re.IGNORECASE),
    ],
    "termino_anticipado": [
        re.compile(r"t[eé]rmino\s+anticipado\s*[:\-]?\s*([^\n\.]{3,150})", re.IGNORECASE),
    ],
    "multas": [
        re.compile(r"multas?\s*(?:por\s+atraso|diaria[s]?)?\s*[:\-]?\s*([^\n\.]{3,150})", re.IGNORECASE),
    ],
}


def extract_text(file_path: str) -> str:
    """Extract plain text from a PDF or Word supporting document."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        reader = PdfReader(file_path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if ext in (".docx", ".doc"):
        doc = Document(file_path)
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    parts.append(cell.text)
        return "\n".join(parts)
    raise ValueError(f"Formato no soportado para extracción: {ext}")


def _normalize_precio(raw: str) -> str:
    """Strip currency symbols/words and thousands separators, leaving a plain numeric string.

    "precio" is auto-typed as a numeric form field (see _infer_field_type), so the
    extracted value must be a bare number — not "$1.500.000" — or the browser
    silently clears it from a <input type="number">.
    """
    cleaned = re.sub(r"(?:UF|UTM|CLP|pesos|\$)", "", raw, flags=re.IGNORECASE).strip()
    if "." in cleaned and "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif re.search(r"\.\d{3}(\D|$)", cleaned):
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    return match.group(0) if match else raw


def extract_fields(text: str) -> dict[str, str | None]:
    """Run extraction rules over document text, returning one value per canonical field."""
    results: dict[str, str | None] = {field: None for field in CANONICAL_FIELDS}
    for field, patterns in EXTRACTION_RULES.items():
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                value = match.group(1).strip().rstrip(",;")
                if field == "precio":
                    value = _normalize_precio(value)
                results[field] = value
                break
    return results
