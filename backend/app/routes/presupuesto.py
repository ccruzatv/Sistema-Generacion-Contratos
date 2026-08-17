import io
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import PresupuestoCombinacion, User, UploadLog
from ..services.auth import get_current_user, require_superadmin

router = APIRouter(prefix="/api/presupuesto", tags=["presupuesto"])

_CODE_RE = re.compile(r"^\s*(\d{7})\s+(.+?)\s*$")


@router.post("/upload")
def upload_presupuesto(
    file: UploadFile = File(...),
    admin: User = Depends(require_superadmin),
    db: Session = Depends(get_db),
):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .xlsx")

    content = file.file.read()
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el Excel: {e}")

    combos = {}
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            for cell in row:
                if cell is None:
                    continue
                m = _CODE_RE.match(str(cell))
                if not m:
                    continue
                code, glosa = m.group(1), m.group(2)
                subtitulo, item, asignacion = code[0:2], code[2:4], code[4:7]
                combos[code] = (subtitulo, item, asignacion, glosa)

    if not combos:
        raise HTTPException(
            status_code=400,
            detail="No se encontraron combinaciones válidas (formato esperado: 7 dígitos seguidos de descripción)",
        )

    db.query(PresupuestoCombinacion).delete()
    for subtitulo, item, asignacion, glosa in combos.values():
        db.add(PresupuestoCombinacion(subtitulo=subtitulo, item=item, asignacion=asignacion, glosa=glosa))
    db.add(UploadLog(
        source="presupuesto",
        filename=file.filename,
        record_count=len(combos),
        uploaded_by=getattr(admin, "email", "") or getattr(admin, "name", ""),
    ))
    db.commit()

    return {"message": f"{len(combos)} combinaciones presupuestarias importadas correctamente"}


@router.get("/subtitulos")
def list_subtitulos(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PresupuestoCombinacion.subtitulo)
        .distinct()
        .order_by(PresupuestoCombinacion.subtitulo)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/items")
def list_items(subtitulo: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PresupuestoCombinacion.item)
        .filter(PresupuestoCombinacion.subtitulo == subtitulo)
        .distinct()
        .order_by(PresupuestoCombinacion.item)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/asignaciones")
def list_asignaciones(
    subtitulo: str, item: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = (
        db.query(PresupuestoCombinacion)
        .filter(PresupuestoCombinacion.subtitulo == subtitulo, PresupuestoCombinacion.item == item)
        .order_by(PresupuestoCombinacion.asignacion)
        .all()
    )
    return [{"asignacion": r.asignacion, "glosa": r.glosa} for r in rows]


@router.get("/count")
def count_presupuesto(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return {"total": db.query(PresupuestoCombinacion).count()}
