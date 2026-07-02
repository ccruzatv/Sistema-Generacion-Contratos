"""
Service to fetch the current UTM (Unidad Tributaria Mensual) value from the SII.

Primary source: mindicador.cl API (free, public, JSON)
Fallback source: SII website scraping
Last resort: hardcoded monthly values for the current year
"""

import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

try:
    _CHILE_TZ = ZoneInfo("America/Santiago")
except KeyError:
    _CHILE_TZ = timezone(timedelta(hours=-4))

try:
    import requests
except ImportError:
    requests = None

try:
    from lxml import html as lxml_html
except ImportError:
    lxml_html = None

logger = logging.getLogger(__name__)

# Cache: { "2026-04": 69000 }
_utm_cache: dict[str, float] = {}

# Fallback UTM values (updated periodically)
_FALLBACK_UTM = 69_880  # approximate UTM for 2026


def get_current_utm() -> dict:
    """
    Return the current UTM value and the month it corresponds to.
    Returns: {"valor": float, "mes": str, "anio": int, "fuente": str}
    """
    now = datetime.now(_CHILE_TZ)
    month = now.month
    year = now.year
    cache_key = f"{year}-{month:02d}"

    if cache_key in _utm_cache:
        return {
            "valor": _utm_cache[cache_key],
            "mes": _month_name(month),
            "anio": year,
            "fuente": "cache",
        }

    # Try mindicador.cl API first
    valor = _fetch_from_mindicador(year, month)
    source = "mindicador.cl"

    # Try SII scraping if mindicador failed
    if valor is None:
        valor = _fetch_from_sii(year, month)
        source = "sii.cl"

    # Fallback
    if valor is None:
        valor = _FALLBACK_UTM
        source = "valor referencial"

    _utm_cache[cache_key] = valor
    return {
        "valor": valor,
        "mes": _month_name(month),
        "anio": year,
        "fuente": source,
    }


def _fetch_from_mindicador(year: int, month: int) -> float | None:
    """Fetch UTM from mindicador.cl public API."""
    if requests is None:
        return None
    try:
        url = f"https://mindicador.cl/api/utm/{month:02d}-{year}"
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; BasesEstandarizadas/1.0)",
        }
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            serie = data.get("serie", [])
            if serie:
                return float(serie[0]["valor"])
    except Exception as e:
        logger.warning(f"mindicador.cl fetch failed: {e}")
    return None


def _fetch_from_sii(year: int, month: int) -> float | None:
    """Scrape UTM value from the SII website."""
    if requests is None or lxml_html is None:
        return None
    try:
        url = f"https://www.sii.cl/valores_y_fechas/utm/utm{year}.htm"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "es-CL,es;q=0.9",
        }
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        tree = lxml_html.fromstring(resp.content)
        # The SII table has months as rows; find the row for the current month
        month_names_es = [
            "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
        ]
        target_month = month_names_es[month]

        rows = tree.xpath("//table//tr")
        for row in rows:
            cells = row.xpath(".//td")
            if not cells:
                continue
            first_cell = cells[0].text_content().strip()
            if target_month.lower() in first_cell.lower():
                # The UTM value is typically in the second cell
                if len(cells) >= 2:
                    raw = cells[1].text_content().strip()
                    # Parse "$ 69.880" or "69.880" or "69880"
                    cleaned = raw.replace("$", "").replace(".", "").replace(",", ".").strip()
                    return float(cleaned)
    except Exception as e:
        logger.warning(f"SII scrape failed: {e}")
    return None


def _month_name(month: int) -> str:
    names = [
        "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ]
    return names[month] if 1 <= month <= 12 else ""


def recommend_bidding_type(monto: float, utm_valor: float) -> dict:
    """
    Given a monetary amount and the UTM value, determine the recommended
    bidding type (L1, LE, LP, LR).
    """
    if utm_valor <= 0:
        return {"tipo": None, "utm_count": 0, "message": "Valor UTM inválido"}

    utm_count = monto / utm_valor

    if utm_count < 100:
        tipo = "L1"
        desc = "Licitación menor a 100 UTM"
    elif utm_count < 1000:
        tipo = "LE"
        desc = "Licitación entre 100 y 1.000 UTM"
    elif utm_count < 5000:
        tipo = "LP"
        desc = "Licitación entre 1.000 y 5.000 UTM"
    else:
        tipo = "LR"
        desc = "Licitación mayor a 5.000 UTM"

    return {
        "tipo": tipo,
        "utm_count": round(utm_count, 2),
        "description": desc,
    }
