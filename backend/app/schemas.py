from pydantic import BaseModel
from datetime import datetime


# ── Auth ──

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: "UserResponse"


# ── User ──

class UserCreate(BaseModel):
    email: str
    name: str
    role: str = "operativo"
    password: str
    jurisdiccion: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None
    jurisdiccion: str | None = None


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    jurisdiccion: str | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Category ──

class CategoryResponse(BaseModel):
    id: int
    name: str
    order: int
    parent_id: int | None = None
    template_count: int = 0
    children: list["CategoryResponse"] = []

    model_config = {"from_attributes": True}


class CategoryCreate(BaseModel):
    name: str
    order: int = 0
    parent_id: int | None = None


# ── Template Field ──

class TemplateFieldBase(BaseModel):
    field_key: str
    field_label: str
    field_type: str = "text"
    field_order: int = 0
    required: bool = True
    placeholder: str = ""
    options: str = ""


class TemplateFieldCreate(TemplateFieldBase):
    pass


class TemplateFieldUpdate(BaseModel):
    field_label: str | None = None
    field_type: str | None = None
    field_order: int | None = None
    required: bool | None = None
    placeholder: str | None = None
    options: str | None = None


class TemplateFieldResponse(TemplateFieldBase):
    id: int
    template_id: int

    model_config = {"from_attributes": True}


# ── Template ──

class TemplateBase(BaseModel):
    name: str
    description: str = ""


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category_id: int | None = None


class TemplateResponse(TemplateBase):
    id: int
    file_path: str
    category_id: int | None = None
    category_name: str | None = None
    created_at: datetime
    updated_at: datetime
    fields: list[TemplateFieldResponse] = []

    model_config = {"from_attributes": True}


class TemplateListResponse(TemplateBase):
    id: int
    category_id: int | None = None
    category_name: str | None = None
    created_at: datetime
    field_count: int = 0

    model_config = {"from_attributes": True}


# ── Document ──

class DocumentGenerateRequest(BaseModel):
    template_id: int
    field_values: dict[str, str]
    insumo_ids: list[int] = []
