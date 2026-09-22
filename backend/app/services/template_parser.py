import re
import json
from html import unescape
from docx import Document

_HEADER_RELTYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
_FOOTER_RELTYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"

# Un {{marcador}} puede contener espacios (ej. "{{domicilio de la Corporación}}"),
# pero nunca puede cruzar otra apertura/cierre de llaves — eso evita que una
# llave mal cerrada en el Word "se coma" el siguiente marcador bien formado.
_PLACEHOLDER_RE = re.compile(r"\{\{((?:(?!\{\{|\}\}).)+?)\}\}")
_PARA_RE = re.compile(r"<w:p[ >].*?</w:p>", re.DOTALL)
_RUN_TEXT_RE = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.DOTALL)

# ── Bloques "campo parametrizable": el usuario marca UNA opción con una X,
# y el sistema arma una sola frase final a partir de la opción elegida. ──
_GUIA_RE = re.compile(r"^\s*▸")
_PARAM_MARKER_RE = re.compile(r"campo\s+parametrizable\s*[—\-–]*\s*marque\s+una\s+opci[oó]n\s*:\s*(.+)", re.IGNORECASE)
_OPTION_RE = re.compile(r"^\s*☐\s*(.*)$")
_BLANK_RE = re.compile(r"\[_{2,}\]")
_INLINE_OPCION_RE = re.compile(r"^\s*\[OPCION:([^\]]+)\]\s*", re.IGNORECASE)
_SI_OPCION_RE = re.compile(r"\[SI_OPCION:([^\]]+)\]", re.IGNORECASE)
_FIN_SI_RE = re.compile(r"\[FIN_SI\]", re.IGNORECASE)


def normalize_key(raw: str) -> str:
    """Vuelve seguro un texto libre (etiqueta de bloque, texto de opción) para
    usarlo como field_key/option value: sin espacios ni signos, en minúsculas."""
    import unicodedata
    text = unicodedata.normalize("NFD", raw)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "opcion"


def _derive_option_key(opt_text: str, used_keys: set[str]) -> str:
    """Auto-generate a stable option key from its text when no explicit
    [OPCION:x] tag was given. Grows the word count, then appends a numeric
    suffix, until it no longer collides with a sibling option in the same
    block — options that share their first few words (ej. "El Contratista
    es persona jurídica" / "... persona natural") would otherwise resolve
    to the exact same key. Must stay in lockstep with the identical
    algorithm in document_generator.py, since both derive keys independently
    from the same option text at parse time and at generation time.
    """
    words = opt_text.split()
    for n in (4, 6, 8, len(words)):
        key = normalize_key(" ".join(words[:n]))
        if key not in used_keys:
            return key
    base = normalize_key(" ".join(words[:4]))
    n = 2
    while f"{base}_{n}" in used_keys:
        n += 1
    return f"{base}_{n}"


def extract_placeholders(file_path: str) -> list[dict]:
    """Extract {{placeholder}} and choice ("campo parametrizable") fields from a Word document.

    Scans body paragraphs (sequentially, to detect parametrizable blocks and
    their conditional tags), body tables, then every header/footer OPC part
    via raw XML for plain {{}} fields — guaranteeing detection regardless of
    table layout, run splitting, or first-page/even-page footer variants.
    Returns a list of unique fields ordered by their appearance in the document.
    """
    doc = Document(file_path)
    body_paragraphs = [p.text for p in doc.paragraphs]

    fields: list[dict] = []
    seen: set[str] = set()
    order = 0

    # ── Pass 1: locate every "campo parametrizable" block and its options ──
    # option_key_to_choice maps an option's key (either an inline [OPCION:x]
    # tag on its "☐" line, or an auto-generated slug) to the choice field's
    # own key — used below to resolve [OPCION:x] tags found elsewhere in the
    # document as content conditional on that choice.
    option_key_to_choice: dict[str, str] = {}
    block_ranges: list[tuple[int, int]] = []  # (start, end) paragraph indices to skip in pass 2

    i = 0
    while i < len(body_paragraphs):
        marker_match = _PARAM_MARKER_RE.search(body_paragraphs[i].strip())
        if not marker_match:
            i += 1
            continue

        label = marker_match.group(1).strip().rstrip(":.")
        choice_key = normalize_key(label)
        block_start = i
        j = i + 1
        options = []
        used_option_keys: set[str] = set()
        while j < len(body_paragraphs):
            opt_match = _OPTION_RE.match(body_paragraphs[j])
            if not opt_match:
                break
            opt_text = opt_match.group(1).strip()
            inline_tag = _INLINE_OPCION_RE.match(opt_text)
            if inline_tag:
                opt_key = normalize_key(inline_tag.group(1))
                opt_text = opt_text[inline_tag.end():].strip()
            else:
                opt_key = _derive_option_key(opt_text, used_option_keys)
            used_option_keys.add(opt_key)
            has_blank = bool(_BLANK_RE.search(opt_text))
            options.append({"value": opt_key, "label": opt_text, "has_blank": has_blank})
            option_key_to_choice[opt_key] = choice_key
            j += 1

        if options and choice_key not in seen:
            seen.add(choice_key)
            fields.append({
                "field_key": choice_key,
                "field_label": label[0:1].upper() + label[1:],
                "field_type": "choice",
                "field_order": order,
                "required": True,
                "options": json.dumps(options, ensure_ascii=False),
            })
            order += 1
            block_ranges.append((block_start, j - 1))
        i = j if options else i + 1

    def _in_block(idx: int) -> bool:
        return any(start <= idx <= end for start, end in block_ranges)

    # ── Pass 2: regular {{}} fields, skipping parametrizable-block paragraphs
    # and guide notes, but resolving [OPCION:x] / [SI_OPCION:x] tags found on
    # other paragraphs to mark the fields they contain as conditional
    # (depends_on = "<choice_field_key>=<option_key>"). ──────────────────
    for idx, text in enumerate(body_paragraphs):
        if _in_block(idx) or _GUIA_RE.match(text):
            continue
        stripped = text.strip()
        depends_on = None

        tag_match = _INLINE_OPCION_RE.match(stripped)
        if tag_match:
            opt_key = normalize_key(tag_match.group(1))
            choice_key = option_key_to_choice.get(opt_key)
            if choice_key:
                depends_on = f"{choice_key}={opt_key}"

        si_match = _SI_OPCION_RE.search(stripped)
        if si_match and not depends_on:
            opt_key = normalize_key(si_match.group(1))
            choice_key = option_key_to_choice.get(opt_key)
            if choice_key:
                depends_on = f"{choice_key}={opt_key}"

        _extract_ordered(text, fields, seen, depends_on)

    # ── Body tables (no parametrizable-block support inside tables) ──────
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _extract_ordered(paragraph.text, fields, seen, None)

    # ── Headers & footers: raw XML of every OPC part ──────────────────
    for rel in doc.part.rels.values():
        if rel.reltype in (_HEADER_RELTYPE, _FOOTER_RELTYPE):
            try:
                raw_xml = rel.target_part.blob.decode("utf-8", errors="ignore")
                for para_xml in _PARA_RE.findall(raw_xml):
                    texts = _RUN_TEXT_RE.findall(para_xml)
                    combined = unescape("".join(texts))
                    _extract_ordered(combined, fields, seen, None)
            except Exception:
                pass

    # Re-number field_order sequentially and fill in label/type for plain fields.
    result = []
    for i, f in enumerate(fields):
        f["field_order"] = i
        if "field_type" not in f:
            key = f["field_key"]
            f["field_label"] = key.replace("_", " ").replace("-", " ").title()
            f["field_type"] = _infer_field_type(key)
            f["required"] = f["field_type"] != "tabla_tribunales"
        result.append(f)
    return result


def _extract_ordered(text: str, fields: list[dict], seen: set[str], depends_on: str | None) -> None:
    for match in _PLACEHOLDER_RE.finditer(text):
        raw_key = match.group(1)
        key = re.sub(r"\s+", "_", raw_key.strip())
        if not key or key in seen:
            continue
        seen.add(key)
        entry = {"field_key": key}
        if depends_on:
            entry["depends_on"] = depends_on
        fields.append(entry)


def _infer_field_type(key: str) -> str:
    if key.lower() == "tabla_tribunales":
        return "tabla_tribunales"
    key_lower = key.lower()
    # "_" cuenta como \w para regex, por lo que \b nunca marca un límite en
    # "valor_mensual_en_palabras" — se compara por palabra completa en vez de \b.
    words = set(re.split(r"[^a-záéíóúñ0-9]+", key_lower))
    if key_lower.startswith("tabla_"):
        return "textarea"
    if words & {"palabras", "letras"}:
        return "text"
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
    if words & {"descripcion", "descripción", "observacion", "observación", "detalle", "nota", "notas"}:
        return "textarea"
    return "text"
