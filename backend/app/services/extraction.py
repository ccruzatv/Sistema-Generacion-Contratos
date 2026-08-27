"""Extraccion de datos de insumo desde documentos de respaldo (PDF/Word).

Enfoque en dos capas, en orden de confiabilidad:
1. Pares etiqueta/valor de tablas de 2 columnas (ej. "Vigencia" | "180 días
   corridos..."), que es como suelen venir los datos estructurados en Bases
   Administrativas y cotizaciones reales — mucho mas confiable que buscar en
   prosa. Cada par se etiqueta ademas con el "contexto" (el encabezado de
   sección más cercano antes de la tabla), para poder distinguir, por
   ejemplo, la tabla de "Garantía de Seriedad de la Oferta" de otra de
   "Garantía de Fiel Cumplimiento" que reutilice las mismas etiquetas
   ("Monto", "Vigencia", "Glosa").
2. Reglas de patrones (regex) ancladas a frases especificas y pertinentes
   sobre el texto corrido — no a una sola palabra suelta, para evitar
   capturar la mencion equivocada cuando un termino aparece varias veces con
   distinto sentido (ej. "Garantía de Fiel Cumplimiento" vs "Garantía de
   Seriedad de la Oferta").

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
from docx.table import Table
from docx.text.paragraph import Paragraph
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


# ── Estructura del documento: párrafos + pares de tabla con contexto ──────

def _is_heading_like(t: str) -> bool:
    """Encabezado de sección típico de estos documentos: corto, sin punto final."""
    words = t.split()
    return bool(words) and len(words) <= 10 and not t.endswith((".", ",", ";", ":"))


def _docx_structure(file_path: str) -> tuple[list[str], list[tuple[str, str, str]]]:
    """Recorre el .docx en orden real (parrafos + tablas intercaladas).

    Devuelve (parrafos, pares) donde cada par es (etiqueta, valor, contexto):
    contexto es el último párrafo "tipo encabezado" visto antes de la fila.
    """
    doc = Document(file_path)
    paragraphs: list[str] = []
    pairs: list[tuple[str, str, str]] = []
    context = ""
    for block in doc.iter_inner_content():
        if isinstance(block, Paragraph):
            t = block.text.strip()
            if t:
                paragraphs.append(t)
                if _is_heading_like(t):
                    context = t
        elif isinstance(block, Table):
            for row in block.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if len(cells) == 2:
                    pairs.append((cells[0], cells[1], context))
                else:
                    paragraphs.extend(cells)
    return paragraphs, pairs


def _pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def extract_text(file_path: str) -> str:
    """Extract plain text from a PDF or Word supporting document (para inspección/logs)."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return _pdf_text(file_path)
    if ext in (".docx", ".doc"):
        paragraphs, pairs = _docx_structure(file_path)
        lines = list(paragraphs)
        lines += [f"{label}: {value}" for label, value, _ in pairs]
        return "\n".join(lines)
    raise ValueError(f"Formato no soportado para extracción: {ext}")


# ── Helpers de captura ──────────────────────────────────────────────────

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
        after = para[m.end():]
        remainder = after.strip(" :-–—.")
        para_is_short = len(para.split()) <= 8
        has_separator = bool(re.match(r"\s*[:\-–—]", after))
        anchor_starts_paragraph = m.start() == 0
        if para_is_short and (len(remainder) < 3 or _looks_like_heading_remainder(remainder)):
            # El párrafo entero es corto (probable encabezado de sección) —
            # el valor real está en el párrafo siguiente.
            for j in range(i + 1, min(i + 3, len(paragraphs))):
                candidate = paragraphs[j].strip()
                if candidate:
                    return candidate[:max_len]
            continue
        if len(remainder) < 3:
            continue
        if not (has_separator or anchor_starts_paragraph):
            # El ancla es solo una mención incidental dentro de una oración
            # larga (ej. una definición) — no una etiqueta real, se descarta
            # para no capturar texto no relacionado.
            continue
        return remainder[:max_len]
    return None


def _find_nearby(text: str, anchor: re.Pattern, value: re.Pattern, window: int = 200) -> str | None:
    """Busca cada aparición de `anchor` en orden y, para la primera que tenga
    `value` dentro de una ventana de texto después de ella, la devuelve.

    Útil para datos cortos y estructurados (RUT, porcentaje, fecha) que
    acompañan a una frase ancla pero no son el resto de la oración completa.
    Prueba todas las apariciones (no solo la primera) porque una frase ancla
    genérica puede mencionarse varias veces con distinto sentido antes de
    llegar a la cláusula que realmente trae el dato (ej. "garantía de fiel
    cumplimiento" citada de pasada, antes de su cláusula detallada).
    """
    for m in anchor.finditer(text):
        v = value.search(text[m.end():m.end() + window])
        if v:
            return v.group(0).strip()
    return None


def _find_table_value(pairs: list[tuple[str, str, str]], label: re.Pattern, context: re.Pattern | None = None, max_len: int = 300) -> str | None:
    """Busca una fila de tabla cuya etiqueta calce `label` (y, si se indica,
    cuyo contexto de sección calce `context`, para distinguir tablas que
    repiten las mismas etiquetas en secciones distintas)."""
    for row_label, value, row_context in pairs:
        if not label.search(row_label):
            continue
        if context and not context.search(row_context):
            continue
        return value.strip()[:max_len]
    return None


_MONTO = r"\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:UF|UTM|CLP|pesos)?"
_RUT = r"\d{1,2}\.?\d{3}\.?\d{3}[-.]?[\dkK]"
_PORCENTAJE = r"\d{1,3}(?:[.,]\d+)?\s*%"
_FECHA = r"\d{1,2}\s+de\s+[a-zA-ZñÑ]+\s+de\s+\d{4}|\d{1,2}/\d{1,2}/\d{2,4}"
_DIAS = r"(\d{1,4})\s*d[ií]as"


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


def _normalize_monto(raw: str) -> str | None:
    """Deja solo el numero plano del primer monto encontrado — MONTO es un
    campo tipo `number` en el formulario, no acepta texto con "$" ni
    desgloses por zona."""
    m = re.search(r"\$?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?", raw)
    if not m:
        return None
    cleaned = m.group(0).replace("$", "").strip()
    if "." in cleaned and "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif re.search(r"\.\d{3}(\D|$)", cleaned):
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    return match.group(0) if match else None


def _normalize_dias(raw: str) -> str | None:
    m = re.search(_DIAS, raw, re.IGNORECASE)
    return m.group(1) if m else None


# ── Reglas por campo ─────────────────────────────────────────────────────
# Cada regla es una funcion (parrafos, texto_completo, pares_tabla) -> valor | None.
# El nombre de cada entrada DEBE ser normalize_key(marcador_real_de_plantilla).
# Se prueba primero la tabla (mas confiable) y se cae a la prosa si no hay match.

def _rule_nombre_del_servicio(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"nombre\s+del\s+servicio|servicio\s+a\s+contratar|denominaci[oó]n\s+del\s+servicio", re.IGNORECASE), max_len=150)

def _rule_nombre_de_la_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"raz[oó]n\s+social|nombre\s+de\s+la\s+empresa|nombre\s+del\s+oferente|nombre\s+del\s+proveedor", re.IGNORECASE), max_len=150)

def _rule_giro_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"\bgiro\b", re.IGNORECASE), max_len=150)

def _rule_rut_empresa(paras, text, pairs):
    return _find_nearby(text, re.compile(r"raz[oó]n\s+social|nombre\s+de\s+la\s+empresa|nombre\s+del\s+oferente|nombre\s+del\s+proveedor", re.IGNORECASE), re.compile(_RUT))

def _rule_domicilio_de_la_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"domicilio\s+(?:comercial|de\s+la\s+empresa)", re.IGNORECASE), max_len=200)

def _rule_comuna_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"comuna\b(?!\s+de\s+facturaci[oó]n)", re.IGNORECASE), max_len=80)

def _rule_region_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"regi[oó]n\b(?!\s+de\s+facturaci[oó]n)", re.IGNORECASE), max_len=80)

def _rule_nombre_de_la_representante_empresa(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"representante\s+legal(?:\s+de\s+la\s+empresa)?", re.IGNORECASE), max_len=150)

def _rule_rut_representante_enpresa(paras, text, pairs):
    return _find_nearby(text, re.compile(r"representante\s+legal", re.IGNORECASE), re.compile(_RUT))

def _rule_id_licitacion(paras, text, pairs):
    val = _find_nearby(text, re.compile(r"\bid\.?\s*n[°ºo.]*\s*", re.IGNORECASE), re.compile(r"[\w.\-]{4,30}"))
    if val:
        return val
    return _find_nearby(text, re.compile(r"id\.?\s*licitaci[oó]n|n[uú]mero\s+de\s+licitaci[oó]n|licitaci[oó]n\s*n[°ºo.]*\s*", re.IGNORECASE), re.compile(r"[\w.\-]{4,30}"))

def _rule_numero_resolucion(paras, text, pairs):
    return _find_nearby(text, re.compile(r"resoluci[oó]n\s*(?:exenta)?\s*n[°ºo.]?\s", re.IGNORECASE), re.compile(r"[\w.\-\/]{1,20}"))

def _rule_fecha_resolucion(paras, text, pairs):
    raw = _find_nearby(text, re.compile(r"resoluci[oó]n[^\n]{0,60}?de\s+fecha|resoluci[oó]n[^\n]{0,60}?,\s*de\s+fecha", re.IGNORECASE), re.compile(_FECHA))
    return _normalize_fecha(raw) if raw else None

def _rule_duracion_del_servicio(paras, text, pairs):
    table_val = _find_table_value(pairs, re.compile(r"^plazo|^duraci[oó]n|^vigencia$", re.IGNORECASE), re.compile(r"vigencia\s+y\s+duraci[oó]n\s+del\s+contrato|duraci[oó]n\s+del\s+(?:servicio|contrato)", re.IGNORECASE))
    if table_val:
        return table_val
    return _find_value_after_anchor(paras, re.compile(r"duraci[oó]n\s+del\s+(?:servicio|contrato)|plazo\s+del\s+(?:servicio|contrato)|tendr[aá]\s+un\s+plazo\s+de\s+duraci[oó]n\s+de", re.IGNORECASE), max_len=150)

def _rule_fecha_de_inicio(paras, text, pairs):
    raw = _find_nearby(text, re.compile(r"fecha\s+de\s+inicio|inicio\s+del\s+servicio", re.IGNORECASE), re.compile(_FECHA))
    return _normalize_fecha(raw) if raw else None

def _rule_tipo_moneda(paras, text, pairs):
    m = re.search(r"\b(UF|UTM|CLP|USD|d[oó]lares|pesos\s+chilenos|pesos)\b", text, re.IGNORECASE)
    if not m:
        return None
    token = m.group(1).upper()
    return {"DÓLARES": "USD", "DOLARES": "USD", "PESOS CHILENOS": "CLP", "PESOS": "CLP"}.get(token, token)

def _rule_monto(paras, text, pairs):
    # [ \t] (no \n) entre ancla y valor: evita que "capture" el numero de un
    # parrafo siguiente no relacionado cuando el ancla termina una oracion.
    m = re.search(rf"(?:monto|precio|valor)[ \t]+(?:total|del\s+contrato|mensual|neto)?[ \t]*[:\-]?[ \t]*({_MONTO})", text, re.IGNORECASE)
    if not m:
        m = re.search(rf"(?:monto|precio|valor)[ \t]*[:\-][ \t]*({_MONTO})", text, re.IGNORECASE)
    return _normalize_monto(m.group(1)) if m else None

def _rule_porcentaje_garantia_fiel_cumplimiento(paras, text, pairs):
    return _find_nearby(text, re.compile(r"garant[ií]a\s+de\s+fiel\s+cumplimiento", re.IGNORECASE), re.compile(_PORCENTAJE), window=400)

def _rule_glosa_garantia_fiel_cumplimiento(paras, text, pairs):
    table_val = _find_table_value(pairs, re.compile(r"^glosa$", re.IGNORECASE), re.compile(r"fiel\s+cumplimiento", re.IGNORECASE))
    if table_val:
        return table_val
    return _find_value_after_anchor(paras, re.compile(r"garant[ií]a\s+de\s+fiel\s+cumplimiento", re.IGNORECASE), max_len=250)

def _rule_glosa_modificaciones_contrato(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"modificaci(?:o|ó)n(?:es)?\s+del\s+contrato", re.IGNORECASE), max_len=300)

def _rule_direccion_facturacion(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"direcci[oó]n\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=200)

def _rule_comuna_facturacion(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"comuna\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=80)

def _rule_region_facturacion(paras, text, pairs):
    return _find_value_after_anchor(paras, re.compile(r"regi[oó]n\s+de\s+facturaci[oó]n", re.IGNORECASE), max_len=80)

# ── Campos propios de Bases Administrativas (licitaciones) ────────────────

def _rule_direccion_oficina_zonal(paras, text, pairs):
    m = re.search(r"(?:oficina de partes|corporaci[oó]n administrativa[^\n]{0,50}zonal[^\n]{0,20})[^\n]{0,60}?ubicada en\s+([^\n\.]{5,150})", text, re.IGNORECASE)
    return m.group(1).strip() if m else None

def _rule_monto_seriedad_de_la_oferta(paras, text, pairs):
    ctx = re.compile(r"seriedad\s+de\s+la\s+oferta", re.IGNORECASE)
    table_val = _find_table_value(pairs, re.compile(r"^monto$", re.IGNORECASE), ctx)
    if table_val:
        return _normalize_monto(table_val)
    # Exige "$" o una unidad monetaria explicita — de lo contrario un digito
    # suelto (ej. el "3" de "3% del monto ofertado") se confundiria con un monto.
    raw = _find_nearby(text, re.compile(r"garant[ií]a\s+de\s+seriedad\s+de\s+la\s+oferta", re.IGNORECASE), re.compile(r"\$\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:UF|UTM|CLP)\b", re.IGNORECASE), window=400)
    return _normalize_monto(raw) if raw else None

def _rule_dias_corridos_vigencia_seriedad_de_la_oferta(paras, text, pairs):
    ctx = re.compile(r"seriedad\s+de\s+la\s+oferta", re.IGNORECASE)
    table_val = _find_table_value(pairs, re.compile(r"^vigencia$", re.IGNORECASE), ctx)
    if table_val:
        return _normalize_dias(table_val)
    raw = _find_nearby(text, re.compile(r"garant[ií]a\s+de\s+seriedad\s+de\s+la\s+oferta", re.IGNORECASE), re.compile(_DIAS, re.IGNORECASE), window=400)
    return _normalize_dias(raw) if raw else None

def _rule_dias_corridos_vigencia_oferta(paras, text, pairs):
    raw = _find_nearby(text, re.compile(r"vigencia\s+de\s+la\s+oferta|mantener\s+su\s+oferta\s+por\s+un\s+per[ií]odo", re.IGNORECASE), re.compile(_DIAS, re.IGNORECASE), window=200)
    return _normalize_dias(raw) if raw else None

def _rule_porcentaje_evaluacion_tecnica(paras, text, pairs):
    val = _find_table_value(pairs, re.compile(r"^evaluaci[oó]n\s+t[eé]cnica\s*(?:\(?\s*\d{1,3}\s*%\s*\)?)?\s*:?$", re.IGNORECASE))
    if val:
        return val
    return _find_nearby(text, re.compile(r"evaluaci[oó]n\s+t[eé]cnica\s*\(", re.IGNORECASE), re.compile(_PORCENTAJE))

def _rule_porcentaje_evaluacion_patrimonial(paras, text, pairs):
    val = _find_table_value(pairs, re.compile(r"^evaluaci[oó]n\s+patrimonial\s*(?:\(?\s*\d{1,3}\s*%\s*\)?)?\s*:?$", re.IGNORECASE))
    if val:
        return val
    return _find_nearby(text, re.compile(r"evaluaci[oó]n\s+patrimonial\s*\(", re.IGNORECASE), re.compile(_PORCENTAJE))

def _rule_porcentaje_evaluacion_formalidad_antecedentes(paras, text, pairs):
    val = _find_table_value(pairs, re.compile(r"^evaluaci[oó]n\s+(?:de\s+)?formalidad\s+(?:de\s+los?\s+)?antecedentes\s*(?:\(?\s*\d{1,3}\s*%\s*\)?)?\s*:?$", re.IGNORECASE))
    if val:
        return val
    return _find_nearby(text, re.compile(r"evaluaci[oó]n\s+(?:de\s+)?formalidad\s+de\s+los\s+antecedentes\s*\(", re.IGNORECASE), re.compile(_PORCENTAJE))

def _rule_porcentaje_evaluacion_economica(paras, text, pairs):
    val = _find_table_value(pairs, re.compile(r"^evaluaci[oó]n\s+econ[oó]mica\s*(?:\(?\s*\d{1,3}\s*%\s*\)?)?\s*:?$", re.IGNORECASE))
    if val:
        return val
    return _find_nearby(text, re.compile(r"evaluaci[oó]n\s+econ[oó]mica\s*\(", re.IGNORECASE), re.compile(_PORCENTAJE))

def _rule_correo_electronico_para_mercado_publico(paras, text, pairs):
    return _find_nearby(text, re.compile(r"mercado\s*p[uú]blico", re.IGNORECASE), re.compile(r"[\w.\-]+@[\w.\-]+\.\w+"), window=300)


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
    "direccion_oficina_zonal": _rule_direccion_oficina_zonal,
    "monto_seriedad_de_la_oferta": _rule_monto_seriedad_de_la_oferta,
    "dias_corridos_vigencia_seriedad_de_la_oferta": _rule_dias_corridos_vigencia_seriedad_de_la_oferta,
    "dias_corridos_vigencia_oferta": _rule_dias_corridos_vigencia_oferta,
    "porcentaje_evaluacion_tecnica": _rule_porcentaje_evaluacion_tecnica,
    "porcentaje_evaluacion_patrimonial": _rule_porcentaje_evaluacion_patrimonial,
    "porcentaje_evaluacion_formalidad_antecedentes": _rule_porcentaje_evaluacion_formalidad_antecedentes,
    "porcentaje_evaluacion_economica": _rule_porcentaje_evaluacion_economica,
    "correo_electronico_para_mercado_publico": _rule_correo_electronico_para_mercado_publico,
}

CANONICAL_FIELDS = list(EXTRACTION_RULES.keys())


def extract_fields(file_path: str) -> dict[str, str | None]:
    """Run every extraction rule over a PDF/Word document, returning one value per canonical field."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext in (".docx", ".doc"):
        paragraphs, pairs = _docx_structure(file_path)
    else:
        paragraphs, pairs = [p.strip() for p in _pdf_text(file_path).split("\n") if p.strip()], []
    text = "\n".join(paragraphs)

    results: dict[str, str | None] = {}
    for field, rule in EXTRACTION_RULES.items():
        try:
            value = rule(paragraphs, text, pairs)
        except Exception:
            value = None
        results[field] = value.strip().rstrip(",;") if isinstance(value, str) else value
    return results
