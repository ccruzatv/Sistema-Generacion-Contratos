import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  getTemplates,
  getTemplate,
  generateDocument,
  regenerateDocument,
  getDocxDownloadUrl,
  getPdfDownloadUrl,
  getAuthHeaderForDownload,
  submitDraft,
  getPreviewPdfUrl,
  linkBundleItem,
  saveBundleItemDraft,
} from "../services/api";
import DynamicForm from "../components/DynamicForm";
import JurisdiccionSelector from "../components/JurisdiccionSelector";
import InsumoUpload from "../components/InsumoUpload";
import { useToast } from "../components/Toast";

// El backend nombra cada campo canónico de extracción igual que el marcador
// real de la plantilla (normalizado): MONTO -> "monto", DURACION_DEL_SERVICIO
// -> "duracion_del_servicio", etc. — ver normalize_key en extraction.py.
// El emparejamiento es por igualdad exacta de esa clave normalizada, nunca
// por coincidencia parcial de texto: eso evitaba que, por ejemplo, el valor
// detectado para "vigencia" terminara también en un campo "duracion" sin
// relación real con lo extraído.
function normalizeKey(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function matchInsumosToFields(insumos, fields) {
  const merged = {};
  for (const insumo of insumos) {
    for (const [canonical, value] of Object.entries(insumo.extracted || {})) {
      if (!value || merged[canonical]) continue;
      merged[canonical] = value;
    }
  }
  const result = {};
  for (const field of fields || []) {
    const key = normalizeKey(field.field_key);
    if (merged[key]) result[field.field_key] = merged[key];
  }
  return result;
}

export default function GenerateDocument() {
  const { templateId: paramId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const editData = location.state?.editData || null;
  const correctionDocId = location.state?.correctionDocId || null;
  const bundleId = location.state?.bundleId || null;
  const bundleItemId = location.state?.bundleItemId || null;

  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(paramId || (editData?.template_id ? String(editData.template_id) : ""));
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const draftValues = location.state?.draftValues || null;
  // Pre-fill jurisdiction from user profile for operativo/admin; superadmin can choose freely
  const _userJur = user?.jurisdiccion || "";
  const _locJur = editData?.field_values?.jurisdiccion || location.state?.jurisdiccion || "";
  const [jurisdiccion, setJurisdiccion] = useState(_locJur || _userJur);
  const jurisdiccionLocked = (user?.role === "operativo" || user?.role === "admin") && !!_userJur;
  const [initialValues, setInitialValues] = useState(editData?.field_values || draftValues || null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [draftSent, setDraftSent] = useState(false);
  const [draftComment, setDraftComment] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [insumos, setInsumos] = useState([]);

  const isOperativo = user?.role === "operativo";
  const autoFillValues = matchInsumosToFields(insumos, template?.fields);

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(console.error)
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    if (selectedId) {
      getTemplate(selectedId)
        .then((data) => {
          setTemplate(data);
          setResult(null);
          setError("");
          setInsumos([]);
          // Auto-fill jurisdiccion field if template has it and bundle provides it
          if (jurisdiccion && data?.fields) {
            const jurField = data.fields.find((f) =>
              /jurisdic/i.test(f.field_key)
            );
            if (jurField) {
              setInitialValues((prev) => ({
                ...(prev || {}),
                [jurField.field_key]: jurisdiccion,
              }));
            }
          }
        })
        .catch(() => setTemplate(null));
    } else {
      setTemplate(null);
    }
  }, [selectedId]);

  async function handleGenerate(values) {
    if (!jurisdiccion) {
      setError("Seleccione la Jurisdicción");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const payload = { ...values, jurisdiccion };
      const insumoIds = insumos.map((i) => i.id);
      const data = correctionDocId
        ? await regenerateDocument(correctionDocId, Number(selectedId), payload, insumoIds)
        : await generateDocument(Number(selectedId), payload, insumoIds);
      setResult(data);

      // Link to bundle item if we came from an expediente
      if (bundleId && bundleItemId && data.document_id) {
        try {
          await linkBundleItem(bundleId, bundleItemId, data.document_id);
        } catch {
          // non-critical
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft(values) {
    if (!bundleId || !bundleItemId) return;
    setSavingDraft(true);
    try {
      const payload = { ...values, jurisdiccion };
      await saveBundleItemDraft(bundleId, bundleItemId, payload);
      navigate(`/expediente/${bundleId}`);
    } catch (err) {
      toast("Error al guardar borrador: " + err.message, "error");
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleDownload(url, filename) {
    try {
      const res = await fetch(url, { headers: getAuthHeaderForDownload() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Error al descargar");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handlePreview() {
    if (!result?.document_id) return;
    try {
      const url = getPreviewPdfUrl(result.document_id);
      const res = await fetch(url, { headers: getAuthHeaderForDownload() });
      if (!res.ok) throw new Error("Error al generar vista previa");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPreviewUrl(blobUrl);
      setShowPreview(true);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handleSubmitDraft() {
    if (!result?.document_id) return;
    try {
      await submitDraft(result.document_id, draftComment.trim());
      setDraftSent(true);
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  function handleAfterGenerate() {
    if (bundleId) {
      navigate(`/expediente/${bundleId}`);
    } else {
      navigate("/repository");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#112d86]">
          {correctionDocId ? "Corregir Documento" : bundleId ? "Generar Documento" : "Generar Contratos"}
        </h1>
        <p className="text-sm text-[#112d86]/60 mt-1">
          {correctionDocId
            ? "Modifique los campos necesarios y guarde para reenviar a validación"
            : bundleId
            ? "Complete los campos para generar este documento del expediente"
            : "Complete los campos para generar el contrato"}
        </p>
      </div>

      {!bundleId && !correctionDocId && (
        <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
          <label className="block text-sm font-medium text-[#112d86] mb-2">Seleccione una plantilla</label>
          {loadingTemplates ? (
            <p className="text-[#112d86]/40 text-sm">Cargando plantillas...</p>
          ) : templates.length === 0 ? (
            <p className="text-[#112d86]/40 text-sm">No hay plantillas disponibles.</p>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#112d86]/30"
            >
              <option value="">-- Seleccione una plantilla --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.field_count} campos){t.category_name ? ` - ${t.category_name}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {template && template.fields.length > 0 && (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
            {jurisdiccionLocked ? (
              <div>
                <label className="block text-sm font-medium text-[#112d86] mb-1">Jurisdicción</label>
                <div className="flex items-center gap-2 border border-[#112d86]/20 rounded-lg px-3 py-2 bg-[#112d86]/[0.03]">
                  <svg className="w-4 h-4 text-[#112d86]/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                  <span className="text-sm font-medium text-[#112d86]">{jurisdiccion}</span>
                  <span className="ml-auto text-[10px] text-[#112d86]/40 bg-[#112d86]/5 px-2 py-0.5 rounded-full">Asignada a su cuenta</span>
                </div>
              </div>
            ) : (
              <JurisdiccionSelector value={jurisdiccion} onChange={setJurisdiccion} />
            )}
          </div>
          <InsumoUpload insumos={insumos} onChange={setInsumos} />

          <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
            <h2 className="text-lg font-semibold text-[#112d86] mb-1">{template.name}</h2>
            <p className="text-xs text-[#112d86]/40 mb-5">Complete todos los campos requeridos (*)</p>
            <DynamicForm
              key={selectedId}
              fields={template.fields}
              onSubmit={handleGenerate}
              loading={loading}
              initialValues={initialValues}
              autoFillValues={autoFillValues}
              onSaveDraft={bundleId ? handleSaveDraft : null}
              savingDraft={savingDraft}
            />
          </div>
        </>
      )}

      {template && template.fields.length === 0 && (
        <div className="bg-[#c8a84e]/10 border border-[#c8a84e]/30 rounded-xl p-4 text-sm text-[#8a7232]">
          Esta plantilla no tiene campos definidos.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Preview Modal */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#112d86]/10">
              <div>
                <h3 className="text-lg font-semibold text-[#112d86]">Vista previa del documento</h3>
                <p className="text-xs text-[#112d86]/40">Solo lectura — Este documento aún no ha sido validado</p>
              </div>
              <button
                onClick={() => { setShowPreview(false); URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                className="text-[#112d86]/40 hover:text-[#112d86] text-xl font-bold px-2"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={previewUrl + "#toolbar=0&navpanes=0&scrollbar=1"}
                className="w-full h-full border-0"
                title="Vista previa del documento"
              />
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-green-800 font-medium">
              {correctionDocId ? "Documento corregido y reenviado a validación" : "Documento generado exitosamente"}
            </p>
          </div>

          {(correctionDocId || bundleId) ? (
            <button
              onClick={handleAfterGenerate}
              className="w-full text-white py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
              style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
            >
              {bundleId ? "Volver al Expediente" : "Volver al Repositorio"}
            </button>
          ) : isOperativo ? (
            draftSent ? (
              <div className="space-y-3">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm text-yellow-800 font-medium">Borrador enviado a validación exitosamente.</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    Recibirá una notificación cuando la administración revise su documento.
                  </p>
                </div>
                <button
                  onClick={() => navigate("/repository")}
                  className="w-full text-center bg-[#112d86] text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-[#1a3a9e] transition-colors"
                >
                  Ir al Repositorio Personal
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={handlePreview}
                  className="w-full text-center bg-[#112d86] text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-[#1a3a9e] transition-colors"
                >
                  Previsualizar Documento
                </button>
                <div>
                  <label className="block text-sm font-medium text-[#112d86] mb-1">
                    Comentario para el revisor (opcional)
                  </label>
                  <textarea
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    placeholder="Ej: Adjuntar documentos adicionales, aclaración sobre montos, etc."
                    rows={3}
                    className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#112d86]/30 focus:border-[#112d86]/40 bg-white"
                  />
                </div>
                <button
                  onClick={handleSubmitDraft}
                  className="w-full text-center bg-green-600 text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  Enviar borrador a Validación
                </button>
              </div>
            )
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => handleDownload(getDocxDownloadUrl(result.docx_filename), result.docx_filename)}
                className="flex-1 flex items-center justify-center gap-2 text-white py-2.5 px-4 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all"
                style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                Descargar Word (.docx)
              </button>
              <button
                onClick={() => handleDownload(getPdfDownloadUrl(result.docx_filename), result.docx_filename.replace(".docx", ".pdf"))}
                className="flex-1 flex items-center justify-center gap-2 text-white py-2.5 px-4 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all"
                style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                Descargar PDF
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
