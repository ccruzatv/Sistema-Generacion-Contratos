import os
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from sqlalchemy import inspect as sa_inspect, text

from .database import engine, Base, SessionLocal
from . import models  # noqa: ensure all models are registered before create_all
from .scheduler import start_scheduler
from .routes import templates, documents, auth, users, categories, repository, drafts, bundles, dashboard, tribunales, direcciones, presupuesto, uploads, insumos
from .seed import seed_database


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


Base.metadata.create_all(bind=engine)


def _migrate_add_column_if_missing(table: str, column: str, ddl_type: str) -> None:
    """Add a column to an existing Oracle table if it is not already present."""
    inspector = sa_inspect(engine)
    existing = [c["name"].upper() for c in inspector.get_columns(table.upper())]
    if column.upper() not in existing:
        with engine.connect() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD ({column} {ddl_type})"))
            conn.commit()


if engine.dialect.name == "oracle":
    # Migraciones DDL Oracle-específicas: solo aplican al esquema Oracle
    # existente (desa/test). En "local" (SQLite) el esquema se crea desde
    # cero con create_all y ya incluye estas columnas.
    _migrate_add_column_if_missing("draft_submissions", "submitter_comment", "CLOB DEFAULT ''")
    _migrate_add_column_if_missing("categories", "parent_id", "NUMBER(10)")
    _migrate_add_column_if_missing("bundle_items", "draft_values", "CLOB DEFAULT ''")
    _migrate_add_column_if_missing("bundle_items", "is_optional", "NUMBER(1) DEFAULT 0")
    _migrate_add_column_if_missing("users", "token_expires_at", "DATE")
    _migrate_add_column_if_missing("users", "jurisdiccion", "VARCHAR2(100)")

    def _migrate_drop_category_unique_index() -> None:
        """Drop unique index on categories.name if it exists (allows subcategory name duplicates)."""
        inspector = sa_inspect(engine)
        for idx in inspector.get_unique_constraints("CATEGORIES"):
            cols = [c.upper() for c in idx.get("column_names", [])]
            if cols == ["NAME"]:
                with engine.connect() as conn:
                    conn.execute(text(f"DROP INDEX \"{idx['name']}\""))
                    conn.commit()
                break

    _migrate_drop_category_unique_index()

# Ensure tabla_tribunales fields are not required
with engine.connect() as _conn:
    _conn.execute(
        text("UPDATE template_fields SET required = 0 WHERE field_key = 'tabla_tribunales' AND required = 1")
    )
    _conn.commit()


# Seed default admin and categories
db = SessionLocal()
try:
    seed_database(db)
finally:
    db.close()

start_scheduler()

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Sistema de Generación Automatizada de Contratos",
    description="SGAC - Generador de contratos - Poder Judicial de Chile",
    version="2.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(categories.router)
app.include_router(templates.router)
app.include_router(documents.router)
app.include_router(repository.router)
app.include_router(drafts.router)
app.include_router(bundles.router)
app.include_router(dashboard.router)
app.include_router(tribunales.router)
app.include_router(direcciones.router)
app.include_router(presupuesto.router)
app.include_router(uploads.router)
app.include_router(insumos.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "Sistema de Generación Automatizada de Contratos (SGAC) - API funcionando"}
