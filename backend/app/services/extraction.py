"""Extraccion de datos de insumo desde documentos de respaldo (PDF/Word).

Enfoque: texto plano del documento (dividido en parrafos) + reglas de patrones
(regex) ancladas a frases especificas y pertinentes — no a una sola palabra
suelta, para evitar capturar la mencion equivocada cuando un termino aparece
varias veces con distinto sentido (ej. "Garantía de Fiel Cumplimiento" vs
"Garantía de Seriedad de la Oferta").

Cada campo canonico usa el MISMO nombre normalizado que la clave real del
campo de plantilla (ver normalize_key) — así el emparejamiento en el frontend
es 1 a 1 y nunca mezcla el valor de un campo con otro que no corresponde.

EXTRACTION_RULES es el punto de extension: agregar o ajustar una regla de
negocio es sumar/editar entradas aqui, sin tocar el resto del pipeline.
"""
import re
import os
import unicodedata
from docx import Document
from pypdf import PdfReader


def normalize_key(raw: str) -> str:
    """Normaliza un nombre de campo (o marcador de plantilla) a snake_case sin acentos.

    Usado tanto para nombrar los campos canonicos de extraccion como, en el
    frontend, para emparejar esos campos con field_key de la plantilla — debe
    dar el mismo resultado en ambos lados para que el match sea exacto.
    """
    text = unicodedata.normalize("NFD", raw)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text


# ── Helpers de captura ──────────────────────────────────────────────────

def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n") if p.strip()]


def _looks_like_heading_remainder(remainder: str) -> bool:
    """True si lo que sigue en la misma línea parece ser parte del título
    (ej. "TÉRMINO ANTICIPADO DEL CONTRATO" → remainder "DEL CONTRATO"),
    no el valor real — que entonces está en el párrafo siguiente.

    Solo dispara con texto TODO EN MAYÚSCULAS (encabezados típicos de estos
    contratos): un valor corto en formato título ("Providencia",
    "Metropolitana") es perfectamente válido y no debe descartarse."""
    words = remainder.split()
    return bool(words) and len(words) <= 4 and remainder == remainder.upper() and remainder != remainder.lower()


def _find_value_after_anchor(paragraphs: list[str], anchor: re.Pattern, max_len: int = 300) -> str | None:
    """Busca `anchor` en cada párrafo; devuelve el texto pertinente que sigue.

    Si tras el ancla queda muy poco texto (o parece continuación de un
    título), toma el siguiente párrafo no vacío como valor — cubre el caso
    de encabezados de sección seguidos de su contenido en el párrafo de abajo.
    """
    for i, para in enumerate(paragraphs):
        m = anchor.search(para)
        if not m:
            continue
        remainder = para[m.end():].strip(" :-–—.")
        if len(remainder) < 3 or _looks_like_heading_remainder(remainder):
            for j in range(i + 1, min(i + 3, len(paragraphs))):
                candidate = paragraphs[j].strip()
                if candidate and not anchor.search(candidate):
                    return candidate[:max_len]
            continue
        return remainder[:max_len]
    return None


def _find_nearby(text: str, anchor: re.Pattern, value: re.Pattern, window: int = 200) -> str | None:
    """Busca `anchor`, luego `value` dentro de una ventana de texto después de él.

    Útil para datos cortos y estructurados (RUT, porcentaje, fecha) que
    acompañan a una frase ancla pero no son el resto de la oración completa.
    """
    m = anchor.search(text)
    if not m:
        return None
    v = value.search(text[m.end():m.end() + window])
    return v.group(0).strip() if v else None


_MONTO = r"\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:UF|UTM|CLP|pesos)?"
_RUT = r"\d{1,2}\.?\d{3}\.?\d{3}[-.]?[\dkK]"
_PORCENTAJE = r"\d{1,3}(?:[.,]\d+)?\s*%"
_FECHA = r"\d{1,2}[\/\-\s]?(?:de\s+)?(?:\d{1,2}|[a-zA-ZñÑ]+)[\/\-\s]?(?:de\s+)?\d{2,4}"


_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}


def _normalize_fecha(raw: str) -> str:
    """Convierte una fecha en texto (numérica o en palabras, español) a YYYY-MM-DD.

    Los campos de fecha del formulario son <input type="date">, que solo
    acepta ISO — un texto como "15 de marzo de 2026" queda vacío en el
    navegador pese al badge de "detectado" si no se normaliza antes.
    """
    m = re.search(r"(\d{1,2})\s+de\s+([a-zA-ZñÑ]+)\s+de\s+(\d{4})", raw, re.IGNORECASE)
    if m:
        day, month_name, year = m.groups()
        month = _MESES.get(month_name.lower())
        if month:
            return f"{year}-{month:02d}-{int(day):02d}"
    m = re.search(r"(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})", raw)
    if m:
        day, month, year = m.groups()
        if len(year) == 2:
            year = "20" + year
        return f"{year}-{int(month):02d}-{int(day):02d}"
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw)
    if m:
        year, month, day = m.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    return raw


def _normalize_monto(raw: str) -> str:
    """Deja solo el numero plano — MONTO es un campo tipo `number` en el formulario."""
    cleaned = re.sub(r"(?:UF|UTM|CLP|pesos|\$)", "", raw, flags=re.IGNORECASE).strip()
    if "." in cleaned and "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif re.search(r"\.\d{3}(\D|$)", cleaned):
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    return match.group(0) if match else raw


# ── Reglas por campo ─────────────────────────────────────────────────────
# Cada regla es una funcion (parrafos, texto_completo) -> valor | None.
# El nombre de cada entrada DEBE ser normalize_key(marcador_real_de_plantilla).

def _rule_nombre_del_servicio(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"nombre\s+del\s+servicio|servicio\s+a\s+contratar|denominaci[oó]n\s+del\s+servicio", re.IGNORECASE), max_len=150)

def _rule_nombre_de_la_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"raz[oó]n\s+social|nombre\s+de\s+la\s+empresa|nombre\s+del\s+oferente|nombre\s+del\s+proveedor", re.IGNORECASE), max_len=150)

def _rule_giro_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"\bgiro\b", re.IGNORECASE), max_len=150)

def _rule_rut_empresa(paras, text):
    return _find_nearby(text, re.compile(r"raz[oó]n\s+social|nombre\s+de\s+la\s+empresa|empresa", re.IGNORECASE), re.compile(_RUT))

def _rule_domicilio_de_la_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"domicilio\s+(?:comercial|de\s+la\s+empresa)", re.IGNORECASE), max_len=200)

def _rule_comuna_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"comuna\b(?!\s+de\s+facturaci[oó]n)", re.IGNORECASE), max_len=80)

def _rule_region_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"regi[oó]n\b(?!\s+de\s+facturaci[oó]n)", re.IGNORECASE), max_len=80)

def _rule_nombre_de_la_representante_empresa(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"representante\s+legal(?:\s+de\s+la\s+empresa)?", re.IGNORECASE), max_len=150)

def _rule_rut_representante_enpresa(paras, text):
    return _find_nearby(text, re.compile(r"representante\s+legal", re.IGNORECASE), re.compile(_RUT))

def _rule_id_licitacion(paras, text):
    return _find_nearby(text, re.compile(r"id\.?\s*licitaci[oó]n|n[uú]mero\s+de\s+licitaci[oó]n|licitaci[oó]n\s*n[°ºo]", re.IGNORECASE), re.compile(r"[\w.\-]{4,30}"))

def _rule_numero_resolucion(paras, text):
    return _find_nearby(text, re.compile(r"resoluci[oó]n\s*(?:exenta)?\s*n[°ºo.]?\s", re.IGNORECASE), re.compile(r"[\w.\-\/]{1,20}"))

def _rule_fecha_resolucion(paras, text):
    raw = _find_nearby(text, re.compile(r"resoluci[oó]n[^\n]{0,60}?de\s+fecha|resoluci[oó]n[^\n]{0,60}?,\s*de\s+fecha", re.IGNORECASE), re.compile(_FECHA))
    return _normalize_fecha(raw) if raw else None

def _rule_duracion_del_servicio(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"duraci[oó]n\s+del\s+(?:servicio|contrato)|plazo\s+del\s+(?:servicio|contrato)|vigencia\s+del\s+contrato", re.IGNORECASE), max_len=150)

def _rule_fecha_de_inicio(paras, text):
    raw = _find_nearby(text, re.compile(r"fecha\s+de\s+inicio|inicio\s+del\s+servicio", re.IGNORECASE), re.compile(_FECHA))
    return _normalize_fecha(raw) if raw else None

def _rule_tipo_moneda(paras, text):
    m = re.search(r"\b(UF|UTM|CLP|USD|d[oó]lares|pesos\s+chilenos|pesos)\b", text, re.IGNORECASE)
    if not m:
        return None
    token = m.group(1).upper()
    return {"DÓLARES": "USD", "DOLARES": "USD", "PESOS CHILENOS": "CLP", "PESOS": "CLP"}.get(token, token)

def _rule_monto(paras, text):
    m = re.search(rf"(?:monto|precio|valor)\s+(?:total|del\s+contrato|mensual|neto)?\s*[:\-]?\s*({_MONTO})", text, re.IGNORECASE)
    if not m:
        m = re.search(rf"(?:monto|precio|valor)\s*[:\-]\s*({_MONTO})", text, re.IGNORECASE)
    return _normalize_monto(m.group(1)) if m else None

def _rule_porcentaje_garantia_fiel_cumplimiento(paras, text):
    return _find_nearby(text, re.compile(r"garant[ií]a\s+de\s+fiel\s+cumplimiento", re.IGNORECASE), re.compile(_PORCENTAJE))

def _rule_glosa_garantia_fiel_cumplimiento(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"garant[ií]a\s+de\s+fiel\s+cumplimiento", re.IGNORECASE), max_len=250)

def _rule_glosa_modificaciones_contrato(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"modificaci(?:o|ó)n(?:es)?\s+del\s+contrato", re.IGNORECASE), max_len=300)

def _rule_direccion_facturacion(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"direcci[oó]n\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=200)

def _rule_comuna_facturacion(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"comuna\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=80)

def _rule_region_facturacion(paras, text):
    return _find_value_after_anchor(paras, re.compile(r"regi[oó]n\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=80)


EXTRACTION_RULES = {
    "nombre_del_servicio": _rule_nombre_del_servicio,
    "nombre_de_la_empresa": _rule_nombre_de_la_empresa,
    "giro_empresa": _rule_giro_empresa,
    "rut_empresa": _rule_rut_empresa,
    "domicilio_de_la_empresa": _rule_domicilio_de_la_empresa,
    "comuna_empresa": _rule_comuna_empresa,
    "region_empresa": _rule_region_empresa,
    "nombre_de_la_representante_empresa": _rule_nombre_de_la_representante_empresa,
    "rut_representante_enpresa": _rule_rut_representante_enpresa,
    "id_licitacion": _rule_id_licitacion,
    "numero_resolucion": _rule_numero_resolucion,
    "fecha_resolucion": _rule_fecha_resolucion,
    "duracion_del_servicio": _rule_duracion_del_servicio,
    "fecha_de_inicio": _rule_fecha_de_inicio,
    "tipo_moneda": _rule_tipo_moneda,
    "monto": _rule_monto,
    "porcentaje_garantia_fiel_cumplimiento": _rule_porcentaje_garantia_fiel_cumplimiento,
    "glosa_garantia_fiel_cumplimiento": _rule_glosa_garantia_fiel_cumplimiento,
    "glosa_modificaciones_contrato": _rule_glosa_modificaciones_contrato,
    "direccion_facturacion": _rule_direccion_facturacion,
    "comuna_facturacion": _rule_comuna_facturacion,
    "region_facturacion": _rule_region_facturacion,
}

CANONICAL_FIELDS = list(EXTRACTION_RULES.keys())


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


def extract_fields(text: str) -> dict[str, str | None]:
    """Run every extraction rule over document text, returning one value per canonical field."""
    paragraphs = _split_paragraphs(text)
    results: dict[str, str | None] = {}
    for field, rule in EXTRACTION_RULES.items():
        try:
            value = rule(paragraphs, text)
        except Exception:
            value = None
        results[field] = value.strip().rstrip(",;") if isinstance(value, str) else value
    return results
