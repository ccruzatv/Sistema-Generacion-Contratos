# SGAC — Sistema de Generación Automatizada de Contratos

**Subdepartamento de Mejoramiento Continuo - Poder Judicial de Chile**

**Versión:** 2.1.0 | **Fecha:** 13.10.2026

## Cambios v2.1.0 (mejoras levantadas en la revisión con el Departamento Jurídico, 02.10.2026)

| Código | Mejora | Implementación |
|--------|--------|----------------|
| M1 | ID de SGF en cada contrato | Campo `sgf_id` en el expediente (creación, edición y vista del revisor) |
| M2 | Vínculo con la carpeta virtual de antecedentes | Campo `carpeta_url` en el expediente, con validación de enlace https |
| M3 | Flujo de aprobación con declaración de carpeta y antecedentes | El envío a revisión exige la carpeta y la declaración; el revisor las ve en su bandeja |
| M4 | Cambios en contratos ya enviados con documento validador | Modificación de contratos pendientes de revisión con motivo y documento validador obligatorios (tabla `documentos_validadores`) |

Nuevos endpoints: `PUT /api/bundles/{id}/antecedentes`, `GET /api/drafts/submit-context/{doc_id}`,
`POST /api/documents/modify-pending/{doc_id}` y `GET /api/documents/validadores/{id}`.
Las columnas nuevas se agregan automáticamente al iniciar el backend (Oracle y SQLite local).

Aplicación web para generar y gestionar documentos de contrato (Word/PDF) a partir de plantillas con campos dinámicos. Incluye flujo de validación de borradores, expedientes de contrato, descarga de documentos aprobados y trazabilidad completa.

## Arquitectura

```
backend/          Python FastAPI + Oracle (oracledb + SQLAlchemy ORM)
  app/
    main.py               Punto de entrada + migraciones + seed + middlewares
    database.py           Conexión Oracle (oracledb thin mode, DB_ENV=desa|test)
    models.py             Modelos ORM SQLAlchemy (mapean tablas Oracle)
    seed.py               Datos iniciales (usuarios + categorías + Anexos)
    routes/
      auth.py             Login / sesión (rate limit 5/min)
      users.py            CRUD usuarios (superadmin)
      categories.py       Gestión de carpetas
      templates.py        CRUD plantillas y campos
      documents.py        Generación y descarga de documentos
      drafts.py           Flujo de validación + notificaciones + preview PDF
      repository.py       Repositorio personal + trazabilidad
      bundles.py          Expedientes (DocumentBundle)
      tribunales.py       Tabla de jurisdicciones desde Excel OneDrive
      dashboard.py        Estadísticas generales
      direcciones.py      Direcciones de inmuebles (carga Excel + autocompletado)
      presupuesto.py      Combinaciones presupuestarias Subtítulo/Ítem/Asignación
      uploads.py          Historial de cargas de datos maestros
    scheduler.py        Recordatorios automáticos (3 y 5 días) de borradores pendientes
    services/
      auth.py               Hashing PBKDF2 (600k iter), tokens, dependencias
      template_parser.py    Extrae {{campos}} del .docx
      document_generator.py Rellena plantilla, inserta tabla de tribunales,
                            convierte a PDF, footers de validación
      email_service.py      Notificaciones por correo (invitación, envío a revisión,
                            aprobado, rechazado, recordatorio, cambio de contraseña)
  templates/      Archivos .docx subidos (ruta configurable via TEMPLATES_DIR)
  generated/      Documentos generados (ruta configurable via GENERATED_DIR)
  Dockerfile      Imagen Docker con LibreOffice incluido

frontend/         React 19 + Vite 8 + TailwindCSS 4
  src/
    pages/
      Login.jsx             Inicio de sesión
      TemplateList.jsx      Carpetas + listado de plantillas (página principal)
      TemplateDetail.jsx    Detalle y campos de plantilla
      GenerateDocument.jsx  Formulario dinámico + preview + envío borrador
      Expediente.jsx        Vista de expediente: contrato principal + Anexos opcionales
      BundleList.jsx        Listado de expedientes
      Repository.jsx        Repositorio personal con trazabilidad
      AdminReviews.jsx      Revisión de borradores (admin/superadmin)
      AdminUsers.jsx        Gestión de usuarios (superadmin)
      DatosMaestros.jsx     Carga de Excel de direcciones y presupuesto (superadmin)
    components/
      DynamicForm.jsx         Formulario dinámico con deduplicación de campos,
                              autocompletado de dirección y presupuesto
      UploadTemplate.jsx      Subida de plantilla .docx
      FieldEditor.jsx         Editor de campos de plantilla
      JurisdiccionSelector.jsx Dropdown de jurisdicciones
      ConfirmModal.jsx        Modal de confirmación
      Toast.jsx               Notificaciones toast
    services/
      api.js              Cliente HTTP con auth Bearer
  Dockerfile      Build multi-stage node → nginx
  nginx.conf      Proxy /api/ → backend, SPA fallback

docker-compose.yml   Orquestación completa (backend + frontend + volúmenes)
```

## Stack de Persistencia

El acceso a datos usa dos capas complementarias:

| Capa | Librería | Rol |
|------|----------|-----|
| ORM | **SQLAlchemy** | Define modelos Python, consultas, y ejecuta DDL (`CREATE TABLE`, `ALTER TABLE`) de forma independiente al motor de base de datos |
| Driver | **oracledb** | Conector nativo Oracle en modo thin (sin Oracle Instant Client). Es el que SQLAlchemy usa internamente para hablar con Oracle |

SQLAlchemy **no es** la base de datos — es la capa de abstracción sobre ella. Se mantiene porque simplifica enormemente las consultas, relaciones entre tablas y las migraciones de esquema.

## Base de Datos Oracle

El sistema se conecta a Oracle vía `oracledb` en modo thin (sin Oracle Instant Client).

### Ambientes disponibles

| Ambiente | BDD | Host | Puerto | Servicio | Usuario |
|----------|-----|------|--------|----------|---------|
| `desa` | UNEXDESA | unexdesa.bdd.pjud | 1603 | UNEXDESA | SISTMC |
| `test` | UNEXTEST | unextest.bdd.pjud | 1615 | UNEXTEST | SISTMC |
| `local` | SQLite (archivo) | — | — | — | — |

Seleccionar con `DB_ENV=desa`, `DB_ENV=test` o `DB_ENV=local` en `backend/.env`.

`local` es un ambiente **abierto**: usa SQLite en un archivo (`backend/local.db` por defecto,
configurable con `LOCAL_DB_PATH`), no requiere credenciales ni acceso a la red PJUD, y sirve
para levantar la app y probarla en `http://localhost` sin VPN. Los modelos SQLAlchemy son
compatibles con SQLite; solo las migraciones DDL Oracle-específicas (`ALTER TABLE ... ADD (...)`
en `main.py`) se omiten porque las columnas ya existen en un esquema creado desde cero.

### TNS equivalente (tnsnames.ora)

```
UNEXDESA =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = unexdesa.bdd.pjud)(PORT = 1603))
    (CONNECT_DATA = (SERVER = DEDICATED)(SERVICE_NAME = UNEXDESA))
  )

UNEXTEST =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = unextest.bdd.pjud)(PORT = 1615))
    (CONNECT_DATA = (SERVER = DEDICATED)(SERVICE_NAME = UNEXTEST))
  )
```

### Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DB_ENV` | `desa` (UNEXDESA) o `test` (UNEXTEST) |
| `ORACLE_DESA_HOST` | Host servidor Oracle DESA |
| `ORACLE_DESA_PORT` | Puerto DESA |
| `ORACLE_DESA_SERVICE` | Nombre de servicio DESA |
| `ORACLE_DESA_USER` | Usuario Oracle DESA |
| `ORACLE_DESA_PASS` | Contraseña Oracle DESA |
| `ORACLE_TEST_*` | Equivalentes para el ambiente TEST |

Configurar en `backend/.env` (ver `backend/.env.example`).

## Despliegue con Docker

### Requisitos
- Docker 24+
- Docker Compose v2

### Inicio rápido

```bash
# 1. Copiar y completar configuración
cp backend/.env.example backend/.env
# Editar backend/.env con credenciales Oracle reales

# 2. Construir y levantar
docker-compose up -d --build

# 3. Verificar
curl http://localhost/api/health
```

La aplicación queda disponible en `http://localhost`.

### Variables de entorno relevantes en docker-compose

| Variable | Valor por defecto en Docker |
|----------|-----------------------------|
| `TEMPLATES_DIR` | `/data/templates` |
| `GENERATED_DIR` | `/data/generated` |
| `DB_ENV` | `desa` |

Los datos (plantillas y documentos generados) persisten en volúmenes Docker:
- `smcapp_templates` → plantillas .docx subidas
- `smcapp_generated` → documentos generados

## Sistema de Roles

| Rol | Permisos |
|-----|----------|
| **superadmin** | Control total: cargar/editar/eliminar plantillas, gestionar usuarios y carpetas, validar borradores |
| **admin** | Validar/rechazar borradores, descargar documentos, resubir documentos editados |
| **operativo** | Generar documentos, crear expedientes, enviar borradores, descargar aprobados |

### Credenciales por defecto

| Email | Contraseña | Rol |
|-------|-----------|-----|
| `superadmin@pjud.cl` | `superadmin123` | Superadministrador |
| `admin@pjud.cl` | `admin123` | Administrador Jurídico |
| `operativo@pjud.cl` | `operativo123` | Unidad Requirente |

> Cambie las contraseñas desde Administración tras el primer login.

## Funcionalidades

### Plantillas y campos dinámicos
- Carga de archivos `.docx` con marcadores `{{campo}}`
- Validación de integridad: magic bytes ZIP + estructura DOCX + límite 100 MB
- Detección automática de campos desde el cuerpo, tablas, headers y footers del Word
- Tipos inferidos automáticamente: `fecha`, `email`, `number`, `tel`, `textarea`, `text`, `tabla_tribunales`
- Campos `{{dias_corridos_*}}` y similares → tipo `number` automáticamente
- Editor de campos para superadmin (etiqueta, tipo, requerido/opcional)
- Campo `{{tabla_tribunales}}` → tipo especial opcional que inserta tabla Word desde Excel OneDrive

### Campo `{{tabla_tribunales}}`
- Al generar un documento con este campo, se despliega un dropdown con las jurisdicciones disponibles (hojas del Excel OneDrive)
- Al generar, el backend descarga el Excel desde SharePoint, lee la hoja correspondiente y construye una tabla Word fiel al original:
  - Anchos de columna proporcionales a los del Excel (mínimo 700 twips por columna)
  - Celdas fusionadas (horizontales y verticales) replicadas exactamente
  - Filas de sección (merge horizontal total) con fondo azul claro y negrita
  - Header con fondo navy `#1A2D56` y texto blanco
  - Bordes negros en todas las celdas
- Caché en memoria de 1 hora para evitar descargas repetidas
- Endpoint `/api/tribunales/refresh` para forzar recarga (admin/superadmin)

### Expedientes (Bundles)
- Agrupan todos los documentos de una contrato en un único expediente
- Creación con correlativo, nombre y jurisdicción
- **Contrato principal**: por ahora, una única plantilla de contrato por tipo de contrato
- **Anexos** (opcionales): subcarpeta genérica dentro de cada tipo de contrato; se agregan al expediente solo si hay plantillas cargadas
- Barra de progreso que cuenta únicamente el documento principal (no los Anexos)
- Auto-generación de documentos sin campos directamente desde el expediente
- Pre-relleno automático del campo `{{jurisdiccion}}` con la jurisdicción del expediente
- Estado de envío por documento: generado / enviado / en revisión / aprobado / rechazado
- Botón **Enviar** deshabilitado si el documento ya fue enviado

### Descarga de documentos desde el Expediente
| Botón | Descripción |
|-------|-------------|
| **ZIP Word** | ZIP con todos los documentos aprobados en `.docx` |
| **ZIP PDF** | ZIP con todos los documentos aprobados en `.pdf` |

Nombre de cada archivo descargado: `NombrePlantilla_Jurisdiccion.docx/pdf`

### Flujo de validación de borradores
1. **Operativo** genera documento y lo envía con comentario opcional
2. Preview PDF con marca "EN REVISIÓN – PENDIENTE DE VALIDACIÓN" y valores destacados en amarillo
3. **Admin/Superadmin** recibe notificación, puede descargar, editar y resubir el Word, luego aprobar o rechazar con comentario
4. Al aprobar: se eliminan los destacados y se agrega pie de página con nombre del validador y fecha
5. Al rechazar: operativo puede corregir con formulario pre-llenado y reenviar

### Notificaciones
- Polling cada 30 segundos
- Campana en el header con contador de no leídas
- Notificaciones nativas del navegador (Chrome/Edge)

### Repositorio Personal
- Panel de documentos del usuario con trazabilidad completa (eventos: creado, enviado, aprobado, rechazado, resubido)
- Filtros por estado y búsqueda por texto
- Declaración desierta con certificado obligatorio

## Seguridad

| Control | Detalle |
|---------|---------|
| Hashing | PBKDF2-SHA256 con 600.000 iteraciones |
| Tokens | Bearer tokens con expiración de 8 horas |
| Rate limiting | Login limitado a 5 intentos/minuto por IP |
| Path traversal | Validación de nombres de archivo en todas las descargas |
| Propiedad de archivos | Usuarios solo descargan sus propios documentos |
| Validación MIME | Magic bytes + estructura DOCX + límite 100 MB |
| Security headers | `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy` |

## Requisitos (desarrollo local sin Docker)

- Python 3.11+
- Node.js 20+
- Acceso a Oracle UNEXDESA o UNEXTEST (red PJUD)
- LibreOffice (opcional, para conversión a PDF)
- Acceso a SharePoint `pjudcl-my.sharepoint.com` (para tabla de tribunales)

## Instalación local

### Backend

```bash
cd backend
cp .env.example .env
# Editar .env con credenciales Oracle

pip install -r requirements.txt
uvicorn app.main:app --reload
```

El servidor corre en `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

La app corre en `http://localhost:5173` con proxy al backend.

## Cómo crear plantillas

Cree un `.docx` con marcadores `{{campo}}`:

```
Organismo: {{nombre_organismo}}
Fecha: {{fecha_publicacion}}
Monto: ${{monto_estimado}}
Descripción: {{descripcion_servicio}}
Jurisdicción: {{jurisdiccion}}
```

Tipos inferidos automáticamente según el nombre del campo:
- `fecha_*` → fecha
- `email_*`, `correo_*` → email
- `monto_*`, `precio_*`, `costo_*`, `valor_*` → número
- `*corrido*`, `*plazo*`, `dias_*` → número
- `telefono_*`, `celular_*` → teléfono
- `descripcion_*`, `detalle_*`, `nota_*` → texto largo
- `tabla_tribunales` → dropdown de jurisdicciones (inserta tabla Word desde Excel)

## API Endpoints

Todos requieren `Authorization: Bearer <token>` excepto login y health.

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión (máx. 5/min por IP) |
| GET | `/api/auth/me` | Usuario actual |
| POST | `/api/auth/logout` | Cerrar sesión |

### Usuarios (superadmin)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/users/` | Listar |
| POST | `/api/users/` | Crear |
| PUT | `/api/users/{id}` | Actualizar |
| DELETE | `/api/users/{id}` | Eliminar |

### Plantillas
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/templates/` | Listar |
| POST | `/api/templates/` | Cargar (superadmin) |
| GET | `/api/templates/{id}` | Detalle |
| PUT | `/api/templates/{id}` | Actualizar (superadmin) |
| DELETE | `/api/templates/{id}` | Eliminar (superadmin) |
| POST | `/api/templates/{id}/reparse` | Re-detectar campos |
| PUT | `/api/templates/{id}/fields/{fid}` | Editar campo |
| POST | `/api/templates/{id}/fields` | Agregar campo |
| DELETE | `/api/templates/{id}/fields/{fid}` | Eliminar campo |

### Documentos
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/documents/generate` | Generar documento |
| PUT | `/api/documents/regenerate/{id}` | Regenerar corregido |
| GET | `/api/documents/download/{file}` | Descargar .docx |
| GET | `/api/documents/download-pdf/{file}` | Descargar .pdf |

### Borradores y Validación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/drafts/submit` | Enviar borrador |
| GET | `/api/drafts/my-submissions` | Mis envíos |
| GET | `/api/drafts/pending-reviews` | Pendientes de revisión |
| PUT | `/api/drafts/{id}/review` | Aprobar / rechazar |
| POST | `/api/drafts/{id}/reupload` | Resubir editado |
| GET | `/api/drafts/preview-pdf/{doc_id}` | Preview PDF con marca |
| GET | `/api/drafts/document-fields/{doc_id}` | Datos del formulario |
| GET | `/api/drafts/notifications` | Notificaciones |
| PUT | `/api/drafts/notifications/{id}/read` | Marcar leída |
| PUT | `/api/drafts/notifications/read-all` | Marcar todas leídas |

### Repositorio
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/repository/` | Listar documentos |
| DELETE | `/api/repository/{id}` | Eliminar |
| POST | `/api/repository/{id}/clone` | Declaración desierta |
| GET | `/api/repository/{id}/events` | Trazabilidad |
| GET | `/api/repository/download/{file}` | Descargar .docx |
| GET | `/api/repository/download-pdf/{file}` | Descargar .pdf |

### Expedientes (Bundles)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/bundles/` | Listar expedientes |
| POST | `/api/bundles/` | Crear expediente |
| GET | `/api/bundles/{id}` | Detalle con ítems |
| DELETE | `/api/bundles/{id}` | Eliminar expediente |
| POST | `/api/bundles/{id}/items/{item_id}/link` | Vincular documento generado |
| PUT | `/api/bundles/{id}/items/{item_id}/draft` | Guardar borrador de valores |
| GET | `/api/bundles/{id}/download-all` | ZIP PDF (aprobados) |
| GET | `/api/bundles/{id}/download-all-docx` | ZIP Word (aprobados) |

### Tribunales
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tribunales/` | Listar jurisdicciones (hojas del Excel) |
| POST | `/api/tribunales/refresh` | Forzar recarga del Excel (admin/superadmin) |

### Datos Maestros — Direcciones de Inmuebles
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/direcciones/upload` | Cargar Excel de direcciones (superadmin) |
| GET | `/api/direcciones/jurisdicciones` | Listar jurisdicciones con inmuebles "en uso" |
| GET | `/api/direcciones/buscar` | Buscar inmuebles por jurisdicción y texto |
| GET | `/api/direcciones/count` | Total de direcciones cargadas (superadmin) |

### Datos Maestros — Presupuesto
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/presupuesto/upload` | Cargar Excel de combinaciones presupuestarias (superadmin) |
| GET | `/api/presupuesto/subtitulos` | Listar subtítulos disponibles |
| GET | `/api/presupuesto/items` | Listar ítems de un subtítulo |
| GET | `/api/presupuesto/asignaciones` | Listar asignaciones de subtítulo + ítem |
| GET | `/api/presupuesto/count` | Total de combinaciones cargadas (superadmin) |

### Historial de Cargas
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/uploads/historial` | Últimas 50 cargas de datos maestros (superadmin) |

### Health
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |

---

Desarrollado por Mejoramiento Continuo — ccruzatv@pjud.cl
