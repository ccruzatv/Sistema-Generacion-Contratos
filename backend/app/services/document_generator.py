import os
import re
import copy
import unicodedata
import subprocess
import shutil
from docx import Document


GENERATED_DIR = os.environ.get(
    "GENERATED_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "generated"),
)
os.makedirs(GENERATED_DIR, exist_ok=True)

TRIBUNALES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "tribunales")
_TABLA_KEY = "tabla_tribunales"
_TABLA_PLACEHOLDER = "{{tabla_tribunales}}"
_ALLOWED_IMG_EXT = (".png", ".jpg", ".jpeg")

# {{marcador}} — puede contener espacios, nunca cruza otra llave (ver
# app/services/template_parser.py, que usa el mismo patrón para detectar
# los campos al cargar la plantilla).
_PLACEHOLDER_PATTERN = re.compile(r"\{\{((?:(?!\{\{|\}\}).)+?)\}\}")

# ── "Campo parametrizable": el usuario marca UNA opción con una X y el
# sistema arma una sola frase final a partir de ella (ver template_parser.py
# para la documentación completa de estas marcas). ────────────────────────
_GUIA_RE = re.compile(r"^\s*▸")
_PARAM_MARKER_RE = re.compile(r"campo\s+parametrizable\s*[—\-–]*\s*marque\s+una\s+opci[oó]n\s*:\s*(.+)", re.IGNORECASE)
_OPTION_RE = re.compile(r"^\s*☐\s*(.*)$")
_BLANK_RE = re.compile(r"\[_{2,}\]")
_INLINE_OPCION_RE = re.compile(r"^\s*\[OPCION:([^\]]+)\]\s*", re.IGNORECASE)
_SI_OPCION_RE = re.compile(r"\[SI_OPCION:([^\]]+)\]", re.IGNORECASE)
_FIN_SI_RE = re.compile(r"\[FIN_SI\]", re.IGNORECASE)


def _all_headers_footers(section):
    """Yield all header/footer objects for a section (all variants, no filtering)."""
    for attr in ("header", "footer", "first_page_header", "first_page_footer",
                 "even_page_header", "even_page_footer"):
        hf = getattr(section, attr, None)
        if hf is not None:
            yield hf


def _get_tribunal_image(jurisdiccion: str) -> str | None:
    return None  # image approach removed


def _replace_tabla_tribunales(doc, jurisdiccion: str) -> None:
    """Replace {{tabla_tribunales}} with a Word table built from the OneDrive Excel sheet."""
    from docx.shared import Pt, RGBColor
    from docx.oxml.ns import qn, nsdecls
    from docx.oxml import parse_xml
    from openpyxl.utils import get_column_letter

    ws_data = None
    col_widths_twips = None
    merged_ranges = []

    try:
        from ..routes.tribunales import get_workbook
        wb = get_workbook()
        sheet_name = next(
            (s for s in wb.sheetnames if s.strip().lower() == jurisdiccion.strip().lower()),
            None,
        )
        if sheet_name:
            ws = wb[sheet_name]
            # Read all rows (keep empty rows for correct merge indexing)
            ws_data = [
                [str(cell).strip() if cell is not None else "" for cell in row]
                for row in ws.iter_rows(values_only=True)
            ]
            # Trim trailing all-empty rows
            while ws_data and not any(c for c in ws_data[-1]):
                ws_data.pop()

            # Read actual column widths from Excel
            num_cols = max((len(r) for r in ws_data), default=1)
            raw_widths = []
            for ci in range(num_cols):
                col_letter = get_column_letter(ci + 1)
                dim = ws.column_dimensions.get(col_letter)
                raw_widths.append(dim.width if dim and dim.width else 8.43)

            # Normalize to fit A4 text width (16cm = 9072 twips)
            # Columns narrower than MIN_COL get boosted; remaining width
            # is distributed proportionally among wider columns.
            total_chars = sum(raw_widths) or 1
            PAGE_WIDTH_TWIPS = 9072
            MIN_COL = 700  # ~1.23cm — fits short headers at 8pt without wrapping
            raw_twips = [w / total_chars * PAGE_WIDTH_TWIPS for w in raw_widths]

            col_widths_twips = [None] * len(raw_twips)
            remaining = PAGE_WIDTH_TWIPS
            flex_indices = []
            for i, t in enumerate(raw_twips):
                if t < MIN_COL:
                    col_widths_twips[i] = MIN_COL
                    remaining -= MIN_COL
                else:
                    flex_indices.append(i)
            if flex_indices:
                flex_total = sum(raw_twips[i] for i in flex_indices) or 1
                for i in flex_indices:
                    col_widths_twips[i] = max(MIN_COL, int(raw_twips[i] / flex_total * remaining))
            col_widths_twips = [w or MIN_COL for w in col_widths_twips]

            # Read merged cell ranges
            for mr in ws.merged_cells.ranges:
                merged_ranges.append((
                    mr.min_row - 1, mr.min_col - 1,
                    mr.max_row - 1, mr.max_col - 1,
                ))
    except Exception:
        ws_data = None

    def _cell_borders(tc, color="000000"):
        tcPr = tc.get_or_add_tcPr()
        existing = tcPr.find(qn("w:tcBorders"))
        if existing is not None:
            tcPr.remove(existing)
        tcPr.append(parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:top w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
            f'<w:left w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
            f'<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
            f'<w:right w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
            f'</w:tcBorders>'
        ))

    def _cell_shading(tc, fill_hex):
        tcPr = tc.get_or_add_tcPr()
        existing = tcPr.find(qn("w:shd"))
        if existing is not None:
            tcPr.remove(existing)
        tcPr.append(parse_xml(
            f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{fill_hex}"/>'
        ))

    def _cell_width(tc, twips):
        tcPr = tc.get_or_add_tcPr()
        existing = tcPr.find(qn("w:tcW"))
        if existing is not None:
            tcPr.remove(existing)
        tcPr.insert(0, parse_xml(
            f'<w:tcW {nsdecls("w")} w:w="{twips}" w:type="dxa"/>'
        ))

    def _set_cell_text(cell, text, font_size_pt, bold=False, color_rgb=None):
        cell.text = text
        para = cell.paragraphs[0]
        para.paragraph_format.space_before = Pt(0)
        para.paragraph_format.space_after = Pt(0)
        run = para.runs[0] if para.runs else para.add_run(text)
        run.font.size = Pt(font_size_pt)
        run.bold = bold
        if color_rgb:
            run.font.color.rgb = color_rgb

    def _build_tbl_grid(tbl, widths):
        tbl_elem = tbl._tbl
        existing = tbl_elem.find(qn("w:tblGrid"))
        if existing is not None:
            tbl_elem.remove(existing)
        grid_xml = f'<w:tblGrid {nsdecls("w")}>' + \
            "".join(f'<w:gridCol w:w="{w}"/>' for w in widths) + \
            '</w:tblGrid>'
        tbl_pr = tbl_elem.find(qn("w:tblPr"))
        if tbl_pr is not None:
            tbl_pr.addnext(parse_xml(grid_xml))
        else:
            tbl_elem.insert(0, parse_xml(grid_xml))

    def _set_tbl_fixed_layout(tbl):
        tbl_elem = tbl._tbl
        tbl_pr = tbl_elem.find(qn("w:tblPr"))
        if tbl_pr is None:
            tbl_pr = parse_xml(f'<w:tblPr {nsdecls("w")}/>')
            tbl_elem.insert(0, tbl_pr)
        existing = tbl_pr.find(qn("w:tblLayout"))
        if existing is not None:
            tbl_pr.remove(existing)
        tbl_pr.append(parse_xml(f'<w:tblLayout {nsdecls("w")} w:type="fixed"/>'))

    def _process(paragraphs):
        for para in paragraphs:
            if _TABLA_PLACEHOLDER not in para.text:
                continue
            p_elem = para._element

            if not ws_data:
                for run in para.runs:
                    run.text = ""
                para.add_run(f"[Tabla de Tribunales – {jurisdiccion}]")
                continue

            num_rows = len(ws_data)
            num_cols = max((len(r) for r in ws_data), default=1)
            col_widths = col_widths_twips or ([9072 // num_cols] * num_cols)

            tbl = doc.add_table(rows=num_rows, cols=num_cols)
            _build_tbl_grid(tbl, col_widths)
            _set_tbl_fixed_layout(tbl)

            # Apply merged cells from Excel
            applied_merges = set()
            for (r1, c1, r2, c2) in merged_ranges:
                if r1 >= num_rows or c1 >= num_cols:
                    continue
                r2 = min(r2, num_rows - 1)
                c2 = min(c2, num_cols - 1)
                if r1 == r2 and c1 == c2:
                    continue
                try:
                    tbl.cell(r1, c1).merge(tbl.cell(r2, c2))
                    for ri in range(r1, r2 + 1):
                        for ci in range(c1, c2 + 1):
                            applied_merges.add((ri, ci))
                except Exception:
                    pass

            # Fill cells
            for ri, row_data in enumerate(ws_data):
                for ci in range(num_cols):
                    cell_text = row_data[ci] if ci < len(row_data) else ""
                    # Skip non-primary merged cells (already handled by merge)
                    if (ri, ci) in applied_merges and not any(
                        r1 == ri and c1 == ci for (r1, c1, _, _) in merged_ranges
                    ):
                        continue

                    cell = tbl.cell(ri, ci)
                    _cell_borders(cell._tc)

                    if ri == 0:  # header row
                        _set_cell_text(cell, cell_text, 8, bold=True,
                                       color_rgb=RGBColor(0xFF, 0xFF, 0xFF))
                        _cell_shading(cell._tc, "1A2D56")
                    else:
                        # Section header: merge that starts at col 0 and spans ALL columns
                        is_full_merge = any(
                            r1 == ri and c1 == 0 and ci == 0 and c2 == num_cols - 1
                            for (r1, c1, _, c2) in merged_ranges
                        )
                        _set_cell_text(cell, cell_text, 8,
                                       bold=is_full_merge,
                                       color_rgb=RGBColor(0x1A, 0x2D, 0x56) if is_full_merge else None)
                        if is_full_merge:
                            _cell_shading(cell._tc, "D9E1F2")

            tbl_elem = tbl._element
            p_elem.addprevious(tbl_elem)
            p_elem.getparent().remove(p_elem)

    _process(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                _process(cell.paragraphs)


def _normalize_choice_key(raw: str) -> str:
    text = unicodedata.normalize("NFD", raw)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "opcion"


def _derive_option_key(opt_text: str, used_keys: set) -> str:
    """Must match template_parser.py's identical algorithm exactly — both
    derive an option's key independently from the same text, at parse time
    and at generation time, and need to land on the same value."""
    words = opt_text.split()
    for count in (4, 6, 8, len(words)):
        key = _normalize_choice_key(" ".join(words[:count]))
        if key not in used_keys:
            return key
    base = _normalize_choice_key(" ".join(words[:4]))
    n = 2
    while f"{base}_{n}" in used_keys:
        n += 1
    return f"{base}_{n}"


def _remove_paragraph(paragraph) -> None:
    p = paragraph._element
    parent = p.getparent()
    if parent is not None:
        parent.remove(p)


def _strip_prefix(paragraph, prefix_len: int) -> None:
    """Remove the first `prefix_len` characters from a paragraph (a tag like
    "[OPCION:x] "), preserving run formatting for the rest of the text."""
    if prefix_len <= 0:
        return
    runs = paragraph.runs
    if not runs:
        return
    _splice_run_range(runs, 0, prefix_len, "")


def _resolve_parametrized_blocks(doc, field_values: dict) -> None:
    """Resolve "campo parametrizable" choice blocks and [OPCION:x] /
    [SI_OPCION:x]...[FIN_SI] conditional paragraphs against the submitted
    field_values — BEFORE the normal {{}} substitution pass. Mutates the
    document in place: keeps, rewrites, or deletes paragraphs.

    A choice field's submitted value is the key of the option the user
    picked (e.g. "juridica"); "<choice_key>__blank" carries the free-text
    typed in for an option with its own blank (ej. "Otro plazo: [___] meses").
    """
    paragraphs = list(doc.paragraphs)
    n = len(paragraphs)
    to_remove: list = []

    # Pass 1: marker + consecutive "☐" options -> keep only the chosen one,
    # rewritten as the resolved sentence; delete the marker and other options.
    i = 0
    while i < n:
        marker_match = _PARAM_MARKER_RE.search(paragraphs[i].text.strip())
        if not marker_match:
            i += 1
            continue
        label = marker_match.group(1).strip().rstrip(":.")
        choice_key = _normalize_choice_key(label)
        chosen_value = field_values.get(choice_key)

        j = i + 1
        options = []  # (paragraph, opt_key, opt_text)
        used_option_keys: set = set()
        while j < n:
            opt_match = _OPTION_RE.match(paragraphs[j].text)
            if not opt_match:
                break
            opt_text = opt_match.group(1).strip()
            inline_tag = _INLINE_OPCION_RE.match(opt_text)
            if inline_tag:
                opt_key = _normalize_choice_key(inline_tag.group(1))
                opt_text = opt_text[inline_tag.end():].strip()
            else:
                opt_key = _derive_option_key(opt_text, used_option_keys)
            used_option_keys.add(opt_key)
            options.append((paragraphs[j], opt_key, opt_text))
            j += 1

        if options:
            chosen = None
            for p, opt_key, opt_text in options:
                if opt_key == chosen_value:
                    chosen = (p, opt_text)
                else:
                    to_remove.append(p)
            to_remove.append(paragraphs[i])
            if chosen:
                p, opt_text = chosen
                blank_val = field_values.get(f"{choice_key}__blank", "")
                resolved = _BLANK_RE.sub(lambda m: blank_val, opt_text)
                runs = p.runs
                if runs:
                    _splice_run_range(runs, 0, len(p.text), resolved)
        i = j if options else i + 1

    # Pass 2: standalone guide notes (▸ Guía: ...) are always stripped.
    for p in paragraphs:
        if p not in to_remove and _GUIA_RE.match(p.text.strip()):
            to_remove.append(p)

    # Pass 3: [OPCION:x] tags elsewhere in the document (content written out
    # in full ahead of its choice block) — keep only if x is the value some
    # choice field resolved to; strip the tag from the surviving one.
    chosen_option_keys = {v for v in field_values.values() if isinstance(v, str)}
    for p in paragraphs:
        if p in to_remove:
            continue
        stripped = p.text.strip()
        tag_match = _INLINE_OPCION_RE.match(stripped)
        if not tag_match:
            continue
        opt_key = _normalize_choice_key(tag_match.group(1))
        leading_ws = len(p.text) - len(p.text.lstrip())
        if opt_key in chosen_option_keys:
            _strip_prefix(p, leading_ws + tag_match.end())
        else:
            to_remove.append(p)

    # Pass 4: [SI_OPCION:x] ... [FIN_SI] conditional region.
    i = 0
    while i < n:
        p = paragraphs[i]
        if p in to_remove:
            i += 1
            continue
        si_match = _SI_OPCION_RE.search(p.text)
        if not si_match:
            i += 1
            continue
        opt_key = _normalize_choice_key(si_match.group(1))
        condition_met = opt_key in chosen_option_keys

        fin_match_same = _FIN_SI_RE.search(p.text, si_match.end())
        if fin_match_same:
            if condition_met:
                inner = p.text[si_match.end():fin_match_same.start()].strip()
                runs = p.runs
                if runs:
                    _splice_run_range(runs, 0, len(p.text), inner)
            else:
                to_remove.append(p)
            i += 1
            continue

        to_remove.append(p)
        k = i + 1
        while k < n and not _FIN_SI_RE.search(paragraphs[k].text):
            if not condition_met:
                to_remove.append(paragraphs[k])
            k += 1
        if k < n:
            to_remove.append(paragraphs[k])
        i = k + 1

    for p in to_remove:
        try:
            _remove_paragraph(p)
        except Exception:
            pass


def _apply_replacements(doc, field_values: dict[str, str], highlight: bool = False) -> None:
    """Apply field_values replacements to all paragraphs and tables in doc."""
    for paragraph in doc.paragraphs:
        _replace_in_paragraph(paragraph, field_values, highlight=highlight)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _replace_in_paragraph(paragraph, field_values, highlight=highlight)
    for section in doc.sections:
        for hf in _all_headers_footers(section):
            for paragraph in hf.paragraphs:
                _replace_in_paragraph(paragraph, field_values, highlight=highlight)
            for table in hf.tables:
                for row in table.rows:
                    for cell in row.cells:
                        for paragraph in cell.paragraphs:
                            _replace_in_paragraph(paragraph, field_values, highlight=highlight)


def generate_document(template_path: str, field_values: dict[str, str], output_name: str) -> str:
    """Generate a filled Word document from a template and field values.

    Replaces all {{placeholder}} occurrences with the corresponding values.
    Returns the path to the generated .docx file.
    """
    doc = Document(template_path)
    # Handle tabla_tribunales specially (image insertion, not text)
    jurisdiccion_tabla = field_values.get(_TABLA_KEY)
    text_values = {k: v for k, v in field_values.items() if k != _TABLA_KEY}
    _resolve_parametrized_blocks(doc, text_values)
    _apply_replacements(doc, text_values)
    if jurisdiccion_tabla:
        _replace_tabla_tribunales(doc, jurisdiccion_tabla)

    output_path = os.path.join(GENERATED_DIR, f"{output_name}.docx")
    doc.save(output_path)
    return output_path


def convert_to_pdf(docx_path: str) -> str | None:
    """Convert a .docx file to PDF using LibreOffice.

    Returns the path to the generated PDF, or None if conversion fails.
    """
    libreoffice_cmd = _find_libreoffice()
    if not libreoffice_cmd:
        return None

    output_dir = os.path.dirname(docx_path)
    try:
        subprocess.run(
            [libreoffice_cmd, "--headless", "--convert-to", "pdf", docx_path, "--outdir", output_dir],
            check=True,
            capture_output=True,
            timeout=60,
        )
        pdf_path = docx_path.rsplit(".", 1)[0] + ".pdf"
        if os.path.exists(pdf_path):
            return pdf_path
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return None


def _find_libreoffice() -> str | None:
    # Windows paths
    windows_paths = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]

    for path in windows_paths:
        if os.path.exists(path):
            return path

    # Fallback para Linux/Mac
    for cmd in ["libreoffice", "soffice", "/usr/bin/libreoffice", "/usr/bin/soffice"]:
        if shutil.which(cmd):
            return cmd

    return None


def add_draft_marker(docx_path: str) -> None:
    """Append 'EN REVISIÓN – PENDIENTE DE VALIDACIÓN' to a newly generated document in-place."""
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import nsdecls
    from docx.oxml import parse_xml

    doc = Document(docx_path)

    sep = doc.add_paragraph()
    sep.paragraph_format.space_before = Pt(8)
    sep.paragraph_format.space_after = Pt(4)
    pBdr = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="4" w:space="1" w:color="c8a84e"/>'
        f'</w:pBdr>'
    )
    sep.paragraph_format.element.get_or_add_pPr().append(pBdr)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run("EN REVISIÓN – PENDIENTE DE VALIDACIÓN")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0xC8, 0xA8, 0x4E)
    run.font.name = "Century Gothic"
    run.bold = True
    run.italic = True

    doc.save(docx_path)


def _remove_draft_marker(doc) -> None:
    """Remove all 'EN REVISIÓN' / 'PENDIENTE DE VALIDACIÓN' marker paragraphs from the document."""
    from docx.oxml.ns import qn

    body = doc.element.body
    all_paras = body.findall(qn("w:p"))
    to_remove = []
    for p_elem in all_paras:
        text = "".join(t.text or "" for t in p_elem.findall(f".//{qn('w:t')}"))
        if "EN REVISIÓN" in text or "PENDIENTE DE VALIDACIÓN" in text:
            to_remove.append(p_elem)

    for p_elem in to_remove:
        # Also remove the separator paragraph immediately before each marker
        idx = list(body).index(p_elem)
        if idx > 0:
            prev = list(body)[idx - 1]
            prev_text = "".join(t.text or "" for t in prev.findall(f".//{qn('w:t')}"))
            if not prev_text.strip():
                body.remove(prev)
        body.remove(p_elem)


def _remove_highlights(doc) -> None:
    """Remove any <w:highlight> elements from the document so the final file has no yellow marks."""
    from docx.oxml.ns import qn

    def clean(paragraphs):
        for paragraph in paragraphs:
            for run in paragraph.runs:
                rPr = run._element.find(qn("w:rPr"))
                if rPr is None:
                    continue
                for hl in list(rPr.findall(qn("w:highlight"))):
                    rPr.remove(hl)

    clean(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                clean(cell.paragraphs)
    for section in doc.sections:
        for hf in _all_headers_footers(section):
            clean(hf.paragraphs)
            for table in hf.tables:
                for row in table.rows:
                    for cell in row.cells:
                        clean(cell.paragraphs)


def add_validation_footer(docx_path: str, reviewer_name: str) -> str:
    """Add a validation note at the bottom of the last page of a Word document.

    Adds 'Validado por [reviewer_name]' as a footnote-style paragraph at the end.
    Also strips any remaining yellow highlights so the final approved file is clean.
    Returns the path to the updated document.
    """
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import nsdecls
    from docx.oxml import parse_xml

    doc = Document(docx_path)
    _remove_draft_marker(doc)
    _remove_highlights(doc)

    # Add separator line
    sep = doc.add_paragraph()
    sep.paragraph_format.space_before = Pt(8)
    sep.paragraph_format.space_after = Pt(4)
    pBdr = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="4" w:space="1" w:color="c8a84e"/>'
        f'</w:pBdr>'
    )
    sep.paragraph_format.element.get_or_add_pPr().append(pBdr)

    from datetime import datetime, timezone, timedelta
    from zoneinfo import ZoneInfo
    try:
        tz = ZoneInfo("America/Santiago")
    except KeyError:
        tz = timezone(timedelta(hours=-4))
    today_str = datetime.now(tz).strftime("%d/%m/%Y %H:%M")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)

    run_aprobado = p.add_run("APROBADO")
    run_aprobado.font.size = Pt(9)
    run_aprobado.font.color.rgb = RGBColor(0x16, 0x6E, 0x2A)
    run_aprobado.font.name = "Century Gothic"
    run_aprobado.bold = True

    run_sep = p.add_run(f"  —  Validado por {reviewer_name}  |  {today_str}")
    run_sep.font.size = Pt(8)
    run_sep.font.color.rgb = RGBColor(0x1A, 0x2D, 0x56)
    run_sep.font.name = "Century Gothic"
    run_sep.italic = True

    doc.save(docx_path)
    return docx_path


def _highlight_field_values(doc, field_values: dict) -> None:
    """Highlight all runs whose text matches a field value with yellow background."""
    from docx.enum.dml import MSO_THEME_COLOR
    from docx.oxml.ns import nsdecls, qn
    from docx.oxml import parse_xml

    values = set()
    for v in field_values.values():
        s = str(v).strip()
        if s:
            values.add(s)
    if not values:
        return

    def highlight_runs(paragraphs):
        for paragraph in paragraphs:
            for run in paragraph.runs:
                text = run.text.strip()
                if not text:
                    continue
                for val in values:
                    if val in text:
                        rPr = run._element.get_or_add_rPr()
                        highlight_el = rPr.find(qn("w:highlight"))
                        if highlight_el is None:
                            highlight_el = parse_xml(f'<w:highlight {nsdecls("w")} w:val="yellow"/>')
                            rPr.append(highlight_el)
                        break

    highlight_runs(doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                highlight_runs(cell.paragraphs)
    for section in doc.sections:
        for hf in _all_headers_footers(section):
            highlight_runs(hf.paragraphs)
            for table in hf.tables:
                for row in table.rows:
                    for cell in row.cells:
                        highlight_runs(cell.paragraphs)


def add_pending_footer(docx_path: str, output_path: str, field_values: dict | None = None, template_path: str | None = None) -> str:
    """Create a copy of the document with a 'Borrador' label and validation footer.

    This is for preview purposes; the original file is not modified.
    When template_path + field_values are provided, re-does replacement from the
    original template with yellow highlight on replaced placeholders only.
    Returns the path to the preview copy.
    """
    from docx.shared import Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import nsdecls
    from docx.oxml import parse_xml

    if template_path and field_values and os.path.exists(template_path):
        doc = Document(template_path)
        jurisdiccion_tabla = field_values.get(_TABLA_KEY)
        text_values = {k: v for k, v in field_values.items() if k != _TABLA_KEY}
        _apply_replacements(doc, text_values, highlight=True)
        if jurisdiccion_tabla:
            _replace_tabla_tribunales(doc, jurisdiccion_tabla)
    else:
        doc = Document(docx_path)
        _remove_draft_marker(doc)

    p_borrador = doc.add_paragraph()
    p_borrador.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_borrador.paragraph_format.space_before = Pt(16)
    p_borrador.paragraph_format.space_after = Pt(4)
    run_b = p_borrador.add_run("Borrador")
    run_b.font.size = Pt(18)
    run_b.font.color.rgb = RGBColor(0x1A, 0x2D, 0x56)
    run_b.font.name = "Century Gothic"
    run_b.bold = True

    sep = doc.add_paragraph()
    sep.paragraph_format.space_before = Pt(4)
    sep.paragraph_format.space_after = Pt(4)
    pBdr = parse_xml(
        f'<w:pBdr {nsdecls("w")}>'
        f'<w:top w:val="single" w:sz="4" w:space="1" w:color="c8a84e"/>'
        f'</w:pBdr>'
    )
    sep.paragraph_format.element.get_or_add_pPr().append(pBdr)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run("EN REVISIÓN – PENDIENTE DE VALIDACIÓN")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0xC8, 0xA8, 0x4E)
    run.font.name = "Century Gothic"
    run.bold = True
    run.italic = True

    doc.save(output_path)
    return output_path


def _splice_run_range(runs, start: int, end: int, replacement: str):
    """Replace the [start, end) character range of a paragraph's combined run
    text with `replacement`, remapping across however many runs it spans.
    Returns the first affected run (for optional extra styling), or None.
    """
    char_pos = 0
    run_segments = []
    for i, run in enumerate(runs):
        run_start = char_pos
        run_end = char_pos + len(run.text)
        if run_end > start and run_start < end:
            seg_start = max(start - run_start, 0)
            seg_end = min(end - run_start, len(run.text))
            run_segments.append((i, seg_start, seg_end))
        char_pos = run_end

    if not run_segments:
        return None

    first_idx, first_start, first_end = run_segments[0]
    first_run = runs[first_idx]
    first_run.text = first_run.text[:first_start] + replacement + first_run.text[first_end:]

    for idx, seg_start, seg_end in run_segments[1:]:
        run = runs[idx]
        run.text = run.text[:seg_start] + run.text[seg_end:]

    return first_run


def _replace_in_paragraph(paragraph, field_values: dict[str, str], highlight: bool = False) -> None:
    """Replace {{placeholders}} in a paragraph while preserving formatting.

    Word sometimes splits {{placeholder}} across multiple runs.
    This function reconstructs and replaces them properly.
    When highlight=True, marks the replaced run with yellow background.
    """
    full_text = paragraph.text
    if "{{" not in full_text:
        return

    if not re.search(_PLACEHOLDER_PATTERN, full_text):
        return

    runs = paragraph.runs
    if not runs:
        return

    combined = "".join(run.text for run in runs)
    matches = list(re.finditer(_PLACEHOLDER_PATTERN, combined))
    if not matches:
        return

    # Replace from right to left to preserve positions
    for match in reversed(matches):
        raw_key = match.group(1)
        key = re.sub(r"\s+", "_", raw_key.strip())
        replacement = field_values.get(key, match.group(0))
        first_run = _splice_run_range(runs, match.start(), match.end(), replacement)
        if first_run is None:
            continue

        if highlight and key in field_values:
            from docx.oxml.ns import nsdecls, qn
            from docx.oxml import parse_xml
            rPr = first_run._element.get_or_add_rPr()
            if rPr.find(qn("w:highlight")) is None:
                rPr.append(parse_xml(f'<w:highlight {nsdecls("w")} w:val="yellow"/>'))
