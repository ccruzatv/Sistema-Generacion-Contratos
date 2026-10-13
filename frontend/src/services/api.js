const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, options = {}) {
  const headers = { ...authHeaders(), ...options.headers };
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    throw new Error("No autenticado");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Error ${response.status}`);
  }
  return response;
}

// ── Auth ──

export async function loginApi(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Error al iniciar sesión");
  }
  return res.json();
}

// ── Users ──

export async function getUsers() {
  const res = await request("/users/");
  return res.json();
}

export async function createUser(data) {
  const res = await request("/users/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateUser(id, data) {
  const res = await request(`/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteUser(id) {
  const res = await request(`/users/${id}`, { method: "DELETE" });
  return res.json();
}

// ── Categories ──

export async function getCategories(topLevel = false, parentId = null) {
  const params = [];
  if (topLevel) params.push("top_level=true");
  if (parentId !== null) params.push(`parent_id=${parentId}`);
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  const res = await request(`/categories/${qs}`);
  return res.json();
}

export async function createCategory(data) {
  const res = await request("/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function renameCategory(id, name) {
  const res = await request(`/categories/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function deleteCategory(id) {
  const res = await request(`/categories/${id}`, { method: "DELETE" });
  return res.json();
}

// ── Templates ──

export async function getTemplates(categoryId) {
  const params = categoryId ? `?category_id=${categoryId}` : "";
  const res = await request(`/templates/${params}`);
  return res.json();
}

export async function getTemplate(id) {
  const res = await request(`/templates/${id}`);
  return res.json();
}

export async function createTemplate(name, description, file, categoryId) {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("description", description);
  formData.append("file", file);
  if (categoryId) formData.append("category_id", categoryId);
  const res = await request("/templates/", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export async function updateTemplate(id, data) {
  const res = await request(`/templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteTemplate(id) {
  const res = await request(`/templates/${id}`, { method: "DELETE" });
  return res.json();
}

export async function updateField(templateId, fieldId, data) {
  const res = await request(`/templates/${templateId}/fields/${fieldId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function addField(templateId, data) {
  const res = await request(`/templates/${templateId}/fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteField(templateId, fieldId) {
  const res = await request(`/templates/${templateId}/fields/${fieldId}`, {
    method: "DELETE",
  });
  return res.json();
}

export async function reparseTemplate(id) {
  const res = await request(`/templates/${id}/reparse`, { method: "POST" });
  return res.json();
}

// ── Documents ──

export async function generateDocument(templateId, fieldValues, insumoIds = []) {
  const res = await request("/documents/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: templateId,
      field_values: fieldValues,
      insumo_ids: insumoIds,
    }),
  });
  return res.json();
}

export async function regenerateDocument(docId, templateId, fieldValues, insumoIds = []) {
  const res = await request(`/documents/regenerate/${docId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: templateId,
      field_values: fieldValues,
      insumo_ids: insumoIds,
    }),
  });
  return res.json();
}

export function getDocxDownloadUrl(filename) {
  return `${API_BASE}/documents/download/${filename}`;
}

export function getPdfDownloadUrl(filename) {
  return `${API_BASE}/documents/download-pdf/${filename}`;
}

export function getAuthHeaderForDownload() {
  return { Authorization: `Bearer ${getToken()}` };
}

// ── Repository ──

export async function getRepositoryDocuments() {
  const res = await request("/repository/");
  return res.json();
}

export async function deleteRepositoryDocument(docId) {
  const res = await request(`/repository/${docId}`, { method: "DELETE" });
  return res.json();
}

export function getRepositoryDocxUrl(filename) {
  return `${API_BASE}/repository/download/${filename}`;
}

export function getRepositoryPdfUrl(filename) {
  return `${API_BASE}/repository/download-pdf/${filename}`;
}

export async function getDocumentEvents(docId) {
  const res = await request(`/repository/${docId}/events`);
  return res.json();
}

// ── Drafts ──

// Mejora M3: el envío a revisión incluye la carpeta virtual de antecedentes y
// la declaración de que contiene los antecedentes que validan el contrato.
export async function submitDraft(documentId, comment = "", antecedentes = {}) {
  const res = await request("/drafts/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: documentId,
      comment,
      carpeta_url: antecedentes.carpetaUrl || "",
      antecedentes_confirmados: !!antecedentes.confirmados,
    }),
  });
  return res.json();
}

export async function getSubmitContext(documentId) {
  const res = await request(`/drafts/submit-context/${documentId}`);
  return res.json();
}

// Mejora M4: modificar un contrato pendiente de revisión con documento validador.
export async function modifyPendingDocument(docId, templateId, fieldValues, motivo, validadorFile) {
  const formData = new FormData();
  formData.append("template_id", String(templateId));
  formData.append("field_values_json", JSON.stringify(fieldValues));
  formData.append("motivo", motivo);
  formData.append("validador", validadorFile);
  const res = await request(`/documents/modify-pending/${docId}`, {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export function getValidadorDownloadUrl(validadorId) {
  return `${API_BASE}/documents/validadores/${validadorId}`;
}

export async function getMySubmissions() {
  const res = await request("/drafts/my-submissions");
  return res.json();
}

export async function getPendingReviews() {
  const res = await request("/drafts/pending-reviews");
  return res.json();
}

export async function getReviewedHistory() {
  const res = await request("/drafts/reviewed");
  return res.json();
}

export async function reviewDraft(submissionId, status, comment = "") {
  const res = await request(`/drafts/${submissionId}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, comment }),
  });
  return res.json();
}

export async function getNotifications() {
  const res = await request("/drafts/notifications");
  return res.json();
}

export async function markNotificationRead(notifId) {
  const res = await request(`/drafts/notifications/${notifId}/read`, {
    method: "PUT",
  });
  return res.json();
}

export async function markAllNotificationsRead() {
  const res = await request("/drafts/notifications/read-all", {
    method: "PUT",
  });
  return res.json();
}

export async function getDocumentFields(docId) {
  const res = await request(`/drafts/document-fields/${docId}`);
  return res.json();
}

export function getPreviewPdfUrl(docId) {
  return `/api/drafts/preview-pdf/${docId}`;
}

export async function reuploadDocument(submissionId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await request(`/drafts/${submissionId}/reupload`, {
    method: "POST",
    body: formData,
  });
  return res.json();
}

// ── Bundles (Expedientes) ──

export async function getBundles() {
  const res = await request("/bundles/");
  return res.json();
}

export async function createBundle(data) {
  const res = await request("/bundles/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

// Mejoras M1 y M2: ID de SGF y carpeta virtual de antecedentes del expediente.
export async function updateBundleAntecedentes(bundleId, { sgfId = "", carpetaUrl = "" }) {
  const res = await request(`/bundles/${bundleId}/antecedentes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sgf_id: sgfId, carpeta_url: carpetaUrl }),
  });
  return res.json();
}

export async function getBundle(bundleId) {
  const res = await request(`/bundles/${bundleId}`);
  return res.json();
}

export async function linkBundleItem(bundleId, itemId, documentId) {
  const res = await request(`/bundles/${bundleId}/items/${itemId}/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  return res.json();
}

export function getBundleDownloadAllUrl(bundleId) {
  return `${API_BASE}/bundles/${bundleId}/download-all`;
}

export function getBundleDownloadAllDocxUrl(bundleId) {
  return `${API_BASE}/bundles/${bundleId}/download-all-docx`;
}

// ── Tribunales ──
export async function getTribunalesDisponibles() {
  const res = await request("/tribunales/");
  return res.json();
}

export async function saveBundleItemDraft(bundleId, itemId, values) {
  const res = await request(`/bundles/${bundleId}/items/${itemId}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  return res.json();
}

// ── Datos Maestros: Direcciones ──
export async function uploadDireccionesExcel(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await request("/direcciones/upload", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export async function getDireccionesJurisdicciones() {
  const res = await request("/direcciones/jurisdicciones");
  return res.json();
}

export async function buscarDirecciones(jurisdiccion, q) {
  const params = new URLSearchParams({ jurisdiccion, q: q || "" });
  const res = await request(`/direcciones/buscar?${params.toString()}`);
  return res.json();
}

export async function getDireccionesCount() {
  const res = await request("/direcciones/count");
  return res.json();
}

// ── Datos Maestros: Presupuesto ──
export async function uploadPresupuestoExcel(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await request("/presupuesto/upload", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export async function getSubtitulos() {
  const res = await request("/presupuesto/subtitulos");
  return res.json();
}

export async function getItemsPresupuesto(subtitulo) {
  const params = new URLSearchParams({ subtitulo });
  const res = await request(`/presupuesto/items?${params.toString()}`);
  return res.json();
}

export async function getAsignacionesPresupuesto(subtitulo, item) {
  const params = new URLSearchParams({ subtitulo, item });
  const res = await request(`/presupuesto/asignaciones?${params.toString()}`);
  return res.json();
}

export async function getPresupuestoCount() {
  const res = await request("/presupuesto/count");
  return res.json();
}

export async function getHistorialUploads() {
  const res = await request("/uploads/historial");
  return res.json();
}

export async function reparseAllTemplates() {
  const res = await request("/templates/reparse-all", { method: "POST" });
  return res.json();
}

export async function deleteBundle(bundleId) {
  const res = await request(`/bundles/${bundleId}`, { method: "DELETE" });
  return res.json();
}

// ── Dashboard ──

export async function getDashboardStats() {
  const res = await request("/dashboard/stats");
  return res.json();
}

// ── Insumos (documentos de respaldo para extracción) ──

export async function uploadInsumo(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await request("/insumos/upload", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

export async function deleteInsumo(id) {
  const res = await request(`/insumos/${id}`, { method: "DELETE" });
  return res.json();
}

export async function getInsumosForDocument(documentId) {
  const res = await request(`/insumos/document/${documentId}`);
  return res.json();
}
