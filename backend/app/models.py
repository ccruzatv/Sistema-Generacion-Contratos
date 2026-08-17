from sqlalchemy import Column, Integer, SmallInteger, String, Text, DateTime, ForeignKey, Boolean, CheckConstraint
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from .database import Base

try:
    CHILE_TZ = ZoneInfo("America/Santiago")
except KeyError:
    CHILE_TZ = timezone(timedelta(hours=-4))


def _now_chile():
    # Return naive datetime — Oracle DATE/TIMESTAMP does not carry tz offset.
    return datetime.now(CHILE_TZ).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(500), nullable=False)
    role = Column(String(50), nullable=False, default="operativo")
    jurisdiccion = Column(String(100), nullable=True)
    session_token = Column(String(255), nullable=True, index=True)
    token_expires_at = Column(DateTime, nullable=True)
    is_active = Column(SmallInteger, CheckConstraint("is_active IN (0,1)"), default=1)
    created_at = Column(DateTime, default=lambda: _now_chile())

    documents = relationship("UserDocument", back_populates="user", cascade="all, delete-orphan")
    bundles = relationship("DocumentBundle", back_populates="user", cascade="all, delete-orphan")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    order = Column(Integer, default=0)

    parent = relationship("Category", remote_side="Category.id", back_populates="children")
    children = relationship("Category", back_populates="parent", order_by="Category.order")
    templates = relationship("Template", back_populates="category")


class Template(Base):
    __tablename__ = "templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    file_path = Column(String(500), nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: _now_chile())
    updated_at = Column(
        DateTime,
        default=lambda: _now_chile(),
        onupdate=lambda: _now_chile(),
    )

    category = relationship("Category", back_populates="templates")
    fields = relationship(
        "TemplateField", back_populates="template", cascade="all, delete-orphan"
    )


class TemplateField(Base):
    __tablename__ = "template_fields"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("templates.id"), nullable=False)
    field_key = Column(String(255), nullable=False)
    field_label = Column(String(255), nullable=False)
    field_type = Column(String(50), default="text")
    field_order = Column(Integer, default=0)
    required = Column(SmallInteger, CheckConstraint("required IN (0,1)"), default=1)
    placeholder = Column(String(255), default="")
    options = Column(Text, default="")

    template = relationship("Template", back_populates="fields")


class UserDocument(Base):
    __tablename__ = "user_documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    document_name = Column(String(500), nullable=False)
    document_type = Column(String(50), nullable=False, default="base")
    template_name = Column(String(255), default="")
    category_name = Column(String(255), default="")
    docx_filename = Column(String(500), nullable=False)
    field_values_json = Column(Text, default="")
    template_id_ref = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: _now_chile())

    user = relationship("User", back_populates="documents")
    draft_submissions = relationship(
        "DraftSubmission",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DraftSubmission.submitted_at",
    )
    events = relationship("DocumentEvent", back_populates="document", cascade="all, delete-orphan", order_by="DocumentEvent.created_at")

    @property
    def latest_submission(self):
        """Most recent submission cycle (each correction creates a new one)."""
        return self.draft_submissions[-1] if self.draft_submissions else None


class DraftSubmission(Base):
    __tablename__ = "draft_submissions"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("user_documents.id"), nullable=False, index=True)
    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(50), nullable=False, default="pendiente")  # pendiente, aprobado, rechazado
    comment = Column(Text, default="")
    submitter_comment = Column(Text, default="")
    submitted_at = Column(DateTime, default=lambda: _now_chile())
    reviewed_at = Column(DateTime, nullable=True)

    document = relationship("UserDocument", back_populates="draft_submissions")
    submitter = relationship("User", foreign_keys=[submitted_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    message = Column(Text, nullable=False)
    link = Column(String(500), default="")
    is_read = Column(SmallInteger, CheckConstraint("is_read IN (0,1)"), default=0)
    created_at = Column(DateTime, default=lambda: _now_chile())

    user = relationship("User")


class DocumentEvent(Base):
    __tablename__ = "document_events"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("user_documents.id"), nullable=False, index=True)
    action = Column(String(100), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    actor_role = Column(String(50), default="")
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: _now_chile())

    document = relationship("UserDocument", back_populates="events")
    actor = relationship("User")


class DocumentBundle(Base):
    __tablename__ = "document_bundles"

    id = Column(Integer, primary_key=True, index=True)
    correlativo = Column(Integer, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    category_name = Column(String(255), default="")
    jurisdiccion = Column(String(255), default="")
    nombre_licitacion = Column(String(500), default="")
    created_at = Column(DateTime, default=lambda: _now_chile())

    user = relationship("User", back_populates="bundles")
    items = relationship("BundleItem", back_populates="bundle", cascade="all, delete-orphan", order_by="BundleItem.item_order")


class BundleItem(Base):
    __tablename__ = "bundle_items"

    id = Column(Integer, primary_key=True, index=True)
    bundle_id = Column(Integer, ForeignKey("document_bundles.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("templates.id"), nullable=True)
    template_name = Column(String(255), default="")
    document_id = Column(Integer, ForeignKey("user_documents.id"), nullable=True)
    item_order = Column(Integer, default=0)
    is_completed = Column(SmallInteger, CheckConstraint("is_completed IN (0,1)"), default=0)
    is_optional = Column(SmallInteger, CheckConstraint("is_optional IN (0,1)"), default=0)
    draft_values = Column(Text, default="")

    bundle = relationship("DocumentBundle", back_populates="items")
    template = relationship("Template")
    document = relationship("UserDocument")


class DireccionInmueble(Base):
    __tablename__ = "direcciones_inmuebles"

    id = Column(Integer, primary_key=True, index=True)
    jurisdiccion = Column(String(100), nullable=False, index=True)
    nombre_edificio = Column(String(500), nullable=False)
    direccion_seal = Column(String(500), nullable=False)
    situacion_actual = Column(String(50), default="")
    created_at = Column(DateTime, default=lambda: _now_chile())


class PresupuestoCombinacion(Base):
    __tablename__ = "presupuesto_combinaciones"

    id = Column(Integer, primary_key=True, index=True)
    subtitulo = Column(String(10), nullable=False, index=True)
    item = Column(String(10), nullable=False, index=True)
    asignacion = Column(String(10), nullable=False)
    glosa = Column(String(500), default="")
    created_at = Column(DateTime, default=lambda: _now_chile())


class UploadLog(Base):
    __tablename__ = "upload_logs"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(50), nullable=False, index=True)
    filename = Column(String(500), default="")
    record_count = Column(Integer, default=0)
    uploaded_by = Column(String(255), default="")
    created_at = Column(DateTime, default=lambda: _now_chile())
