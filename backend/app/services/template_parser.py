import re
from html import unescape
from docx import Document

_HEADER_RELTYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
_FOOTER_RELTYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")
_PARA_RE = re.compile(r"<w:p[ >].*?</w:p>", re.DOTALL)
_RUN_TEXT_RE = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.DOTALL)


def extract_placeholders(file_path: str) -> list[dict]:
    """Extract {{placeholder}} fields from a Word document.

    Scans body paragraphs, body tables, then every header/footer OPC part
    via raw XML — guaranteeing detection regardless of table layout, run
    splitting, or first-page/even-page footer variants.
    Returns a list of unique fields ordered by their appearance in the document.
    """
    doc = Document(file_path)
    ordered_keys: list[str] = []
    seen: set[str] = set()

    # ── Body: paragraphs ──────────────────────────────────────────────
    for paragraph in doc.paragraphs:
        _extract_ordered(paragraph.text, ordered_keys, seen)

    # ── Body: tables ──────────────────────────────────────────────────
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _extract_ordered(paragraph.text, ordered_keys, seen)

    # ── Headers & footers: raw XML of every OPC part ──────────────────
    # This approach reconstructs each paragraph's text by concatenating its
    # <w:t> elements — identical to what python-docx's paragraph.text does —
    # but reads directly from the footer/header part bytes so nothing is missed
    # regardless of table nesting, is_linked_to_previous, or run splitting.
    for rel in doc.part.rels.values():
        if rel.reltype in (_HEADER_RELTYPE, _FOOTER_RELTYPE):
            try:
                raw_xml = rel.target_part.blob.decode("utf-8", errors="ignore")
                for para_xml in _PARA_RE.findall(raw_xml):
                    texts = _RUN_TEXT_RE.findall(para_xml)
                    combined = unescape("".join(texts))
                    _extract_ordered(combined, ordered_keys, seen)
            except Exception:
                pass

    fields = []
    for i, key in enumerate(ordered_keys):
        label = key.replace("_", " ").replace("-", " ").title()
        field_type = _infer_field_type(key)
        fields.append(
            {
                "field_key": key,
                "field_label": label,
                "field_type": field_type,
                "field_order": i,
                "required": field_type != "tabla_tribunales",
            }
        )

    return fields


def _extract_ordered(text: str, ordered_keys: list[str], seen: set[str]) -> None:
    for match in _PLACEHOLDER_RE.finditer(text):
        key = match.group(1)
        if key not in seen:
            seen.add(key)
            ordered_keys.append(key)


def _infer_field_type(key: str) -> str:
    if key.lower() == "tabla_tribunales":
        return "tabla_tribunales"
    key_lower = key.lower()
    if any(word in key_lower for word in ["corrido", "plazo", "dias_", "día_", "numero_dia", "número_dia"]):
        return "number"
    if any(word in key_lower for word in ["fecha", "date"]):
        return "date"
    if any(word in key_lower for word in ["email", "correo"]):
        return "email"
    if any(word in key_lower for word in ["monto", "precio", "total", "valor", "amount", "price", "costo"]):
        return "number"
    if any(word in key_lower for word in ["telefono", "teléfono", "celular", "phone", "tel", "movil", "móvil"]):
        return "tel"
    if any(word in key_lower for word in ["descripcion", "descripción", "observacion", "detalle", "nota"]):
        return "textarea"
    return "text"
