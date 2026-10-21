import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";
import {
  getBundle,
  getRepositoryDocxUrl,
  getRepositoryPdfUrl,
  getBundleDownloadAllUrl,
  getBundleDownloadAllDocxUrl,
  getAuthHeaderForDownload,
  getPreviewPdfUrl,
  generateDocument,
  linkBundleItem,
  getDocumentFields,
  updateBundleAntecedentes,
} from "../services/api";
import SubmitDraftModal from "../components/SubmitDraftModal";

export default function Expediente() {
  const { bundleId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingAllDocx, setDownloadingAllDocx] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);
  const [search, setSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [submitDocId, setSubmitDocId] = useState(null);
  // Mejoras M1 y M2: ID de SGF y carpeta virtual de antecedentes del expediente
  const [editingAnt, setEditingAnt] = useState(false);
  const [sgfInput, setSgfInput] = useState("");
  const [carpetaInput, setCarpetaInput] = useState("");
  const [savingAnt, setSavingAnt] = useState(false);

  async function loadBundle() {
    setLoading(true);
    try {
      const data = await getBundle(bundleId);
      setBundle(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBundle();
  }, [bundleId]);

  async function handleDownload(url, filename) {
    try {
      const res = await fetch(url, { headers: getAuthHeaderForDownload() });
      if (!res.ok) throw new Error("Error al descargar");
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

  async function _downloadZip(url, filename, setLoading) {
    setLoading(true);
    try {
      const res = await fetch(url, { headers: getAuthHeaderForDownload() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Error al descargar");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadAll() {
    _downloadZip(
      getBundleDownloadAllUrl(bundleId),
      `Expediente_${bundle.correlativo}_PDF.zip`,
      setDownloadingAll,
    );
  }

  function handleDownloadAllDocx() {
    _downloadZip(
      getBundleDownloadAllDocxUrl(bundleId),
      `Expediente_${bundle.correlativo}_Word.zip`,
      setDownloadingAllDocx,
    );
  }

  function handleSubmitDraft(documentId) {
    // Mejora M3: el envío se realiza desde el modal que solicita la carpeta
    // de antecedentes y la declaración de su existencia.
    setSubmitDocId(documentId);
  }

  async function handleSubmitted() {
    setSubmitDocId(null);
    toast("Borrador enviado exitosamente.", "success");
    await loadBundle();
  }

  function startEditAntecedentes() {
    setSgfInput(bundle?.sgf_id || "");
    setCarpetaInput(bundle?.carpeta_url || "");
    setEditingAnt(true);
  }

  async function handleSaveAntecedentes() {
    setSavingAnt(true);
    try {
      const data = await updateBundleAntecedentes(Number(bundleId), {
        sgfId: sgfInput.trim(),
        carpetaUrl: carpetaInput.trim(),
      });
      setBundle((prev) => ({ ...prev, sgf_id: data.sgf_id, carpeta_url: data.carpeta_url }));
      setEditingAnt(false);
      toast("Antecedentes del expediente actualizados.", "success");
    } catch (err) {
      toast("Error: " + err.message, "error");
    } finally {
      setSavingAnt(false);
    }
  }

  async function handleModifyPending(item) {
    // Mejora M4: modificar un contrato pendiente de revisión con documento validador
    try {
      const fieldsData = await getDocumentFields(item.document_id);
      navigate(`/generate/${item.template_id}`, {
        state: {
          bundleId: Number(bundleId),
          jurisdiccion: bundle?.jurisdiccion || "",
          editData: { field_values: fieldsData.field_values },
          modifyPendingDocId: item.document_id,
        },
      });
    } catch (err) {
      toast("Error al cargar el documento: " + err.message, "error");
    }
  }

  async function handlePreview(documentId) {
    try {
      const url = getPreviewPdfUrl(documentId);
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

  async function handleAutoGenerate(item) {
    setGeneratingId(item.id);
    try {
      const result = await generateDocument(item.template_id, {
        jurisdiccion: bundle?.jurisdiccion || "",
      });
      await linkBundleItem(Number(bundleId), item.id, result.document_id);
      toast("Documento generado automáticamente.", "success");
      await loadBundle();
    } catch (err) {
      toast("Error al generar: " + err.message, "error");
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleGenerate(item) {
    const hasDraft = item.draft_values && Object.keys(item.draft_values).length > 0;
    const isRejected = item.submission_status === "rechazado";

    // If the item already has a generated document, reload its submitted
    // values so the user re-edits them instead of starting from a blank form.
    let editData = null;
    if (item.document_id) {
      try {
        const fieldsData = await getDocumentFields(item.document_id);
        editData = { field_values: fieldsData.field_values };
      } catch {
        // fall back to draft values below
      }
    }

    navigate(`/generate/${item.template_id}`, {
      state: {
        bundleId: Number(bundleId),
        bundleItemId: item.id,
        jurisdiccion: bundle?.jurisdiccion || "",
        editData,
        draftValues: !editData && hasDraft ? item.draft_values : null,
        // Pass correctionDocId when correcting a rejected document so regenerateDocument is called
        correctionDocId: isRejected && item.document_id ? item.document_id : null,
      },
    });
  }

  if (loading) {
    return <div className="text-center py-12 text-[#112d86]/50">Cargando expediente...</div>;
  }

  if (error || !bundle) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 text-sm">{error || "Expediente no encontrado"}</p>
        <button onClick={() => navigate("/generate")} className="mt-4 text-[#112d86] text-sm hover:underline">
          Volver a Expedientes
        </button>
      </div>
    );
  }

  const mainItems = bundle.items.filter((i) => !i.is_optional);
  const approvedCount = bundle.items.filter((i) => i.is_approved).length;
  const annexItems = bundle.items.filter((i) => i.is_optional);
  // A rejected item still needs correction: it doesn't count as completed
  // even though a document was generated for it at some point.
  const completedCount = mainItems.filter((i) => i.is_completed && i.submission_status !== "rechazado").length;
  const totalCount = mainItems.length;
  const allDone = completedCount === totalCount && totalCount > 0;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isOperativo = user?.role === "operativo";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/generate")}
          className="text-[#112d86]/40 hover:text-[#112d86] transition-colors"
          title="Volver a expedientes"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[#112d86]">
            Expediente N° {bundle.correlativo}
          </h1>
          <p className="text-sm text-[#112d86]/60 mt-0.5">
            {bundle.category_name}
            {bundle.nombre_licitacion && <span> — {bundle.nombre_licitacion}</span>}
            {bundle.jurisdiccion && <span className="ml-2 text-[#112d86]/40">· {bundle.jurisdiccion}</span>}
          </p>
        </div>
      </div>

      {/* Antecedentes del contrato (mejoras M1 y M2) */}
      <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[#112d86]">Antecedentes del contrato</span>
          {!editingAnt && (
            <button
              onClick={startEditAntecedentes}
              className="text-xs font-medium text-[#112d86]/60 hover:text-[#112d86] transition-colors"
            >
              Editar
            </button>
          )}
        </div>
        {editingAnt ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#112d86] mb-1">ID de SGF</label>
              <input
                type="text"
                value={sgfInput}
                onChange={(e) => setSgfInput(e.target.value)}
                maxLength={50}
                placeholder="Ej: 12345"
                className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#112d86]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#112d86] mb-1">Enlace a la carpeta virtual de antecedentes</label>
              <input
                type="url"
                value={carpetaInput}
                onChange={(e) => setCarpetaInput(e.target.value)}
                placeholder="https://..."
                className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#112d86]/30"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingAnt(false)}
                disabled={savingAnt}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#112d86]/60 hover:bg-[#112d86]/5"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAntecedentes}
                disabled={savingAnt}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#112d86] hover:bg-[#1a3a9e] disabled:opacity-50"
              >
                {savingAnt ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-[#112d86]/50">ID de SGF</p>
              <p className="font-medium text-[#112d86]">{bundle.sgf_id || <span className="text-[#c8a84e] font-normal">Sin registrar</span>}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-[#112d86]/50">Carpeta de antecedentes</p>
              {bundle.carpeta_url ? (
                <a href={bundle.carpeta_url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#112d86] underline break-all">
                  Abrir carpeta
                </a>
              ) : (
                <p className="text-[#c8a84e]">Sin registrar</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Progress card */}
      <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[#112d86]">Progreso del expediente</span>
          <span className={`text-sm font-bold ${allDone ? "text-green-600" : "text-[#c8a84e]"}`}>
            {completedCount}/{totalCount} documentos
          </span>
        </div>
        <div className="h-2 bg-[#112d86]/8 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: allDone
                ? "linear-gradient(90deg, #16a34a, #15803d)"
                : "linear-gradient(90deg, #c8a84e, #e0c874)",
            }}
          />
        </div>
        {allDone && (
          <p className="text-xs text-green-600 mt-2 font-medium">
            ✓ Todos los documentos del expediente han sido completados
          </p>
        )}
      </div>

      {/* Checklist */}
      <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#112d86]/8 flex items-center justify-between gap-3" style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}>
          <h2 className="text-sm font-semibold text-white">Listado de Contratos</h2>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar antecedente..."
              className="pl-8 pr-3 py-1.5 text-xs bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:bg-white/15 w-44"
            />
          </div>
        </div>
        <div className="divide-y divide-[#112d86]/5">
          {mainItems
            .filter((item) => !search || item.template_name.toLowerCase().includes(search.toLowerCase()))
            .map((item, idx) => {
            const isRejected = item.submission_status === "rechazado";
            return (
            <div key={item.id} className={`px-5 py-4 ${item.is_approved ? "bg-green-50/60" : isRejected ? "bg-red-50/50" : item.is_completed ? "bg-green-50/40" : ""}`}>
              <div className="flex items-center gap-3">
                {/* Order badge */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
                  item.is_approved
                    ? "bg-green-200 text-green-800 border border-green-400"
                    : isRejected
                    ? "bg-red-100 text-red-700 border border-red-300"
                    : item.is_completed
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-[#112d86]/8 text-[#112d86]/50 border border-[#112d86]/15"
                }`}>
                  {isRejected ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : item.is_completed ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>

                {/* Template name */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isRejected ? "text-red-700" : item.is_completed ? "text-green-700" : "text-[#112d86]"}`}>
                    {item.template_name}
                  </p>
                  {item.is_approved ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                      Aprobado — documento bloqueado
                    </span>
                  ) : item.submission_status === "pendiente" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-600 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Enviado — pendiente de validación
                    </span>
                  ) : item.submission_status === "rechazado" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 mt-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Rechazado — requiere corrección
                    </span>
                  ) : item.is_completed ? (
                    <p className="text-[10px] text-green-600/70 mt-0.5">Documento generado</p>
                  ) : item.draft_values && Object.keys(item.draft_values).length > 0 ? (
                    <p className="text-[10px] text-[#c8a84e] mt-0.5 font-medium">Borrador guardado</p>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.is_approved && item.docx_filename ? (
                    /* Approved: Word + PDF + Preview available, editing locked */
                    <>
                      <button
                        onClick={() => handleDownload(getRepositoryDocxUrl(item.docx_filename), item.docx_filename)}
                        className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                        style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
                        title="Descargar Word"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Word
                      </button>
                      <button
                        onClick={() => handleDownload(getRepositoryPdfUrl(item.docx_filename), item.docx_filename.replace(".docx", ".pdf"))}
                        className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                        style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
                        title="Descargar PDF aprobado"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        PDF
                      </button>
                      {item.document_id && (
                        <button
                          onClick={() => handlePreview(item.document_id)}
                          className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                          style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
                          title="Previsualizar documento"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          Ver
                        </button>
                      )}
                    </>
                  ) : item.is_completed && item.docx_filename ? (
                    <>
                      <button
                        onClick={() => handleDownload(getRepositoryDocxUrl(item.docx_filename), item.docx_filename)}
                        className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                        style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
                        title="Descargar Word"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Word
                      </button>
                      <button
                        onClick={() => handleDownload(getRepositoryPdfUrl(item.docx_filename), item.docx_filename.replace(".docx", ".pdf"))}
                        className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                        style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
                        title="Descargar PDF"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        PDF
                      </button>
                      {item.document_id && (
                        <button
                          onClick={() => handlePreview(item.document_id)}
                          className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                          style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
                          title="Previsualizar documento"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          Vista previa
                        </button>
                      )}
                      {isOperativo && !item.submission_status && (
                        <button
                          onClick={() => handleSubmitDraft(item.document_id)}
                          className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all disabled:opacity-50"
                          style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
                          title="Enviar para validación"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                          Enviar
                        </button>
                      )}
                      {isOperativo && item.submission_status === "pendiente" && (
                        <button
                          onClick={() => handleModifyPending(item)}
                          className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                          style={{ background: "linear-gradient(135deg, #c8a84e, #b09640)" }}
                          title="Modificar el contrato por un nuevo antecedente legal (requiere documento validador)"
                        >
                          Modificar con validador
                        </button>
                      )}
                      {item.submission_status !== "pendiente" && (
                      <button
                        onClick={() => handleGenerate(item)}
                        className="inline-flex items-center gap-1 bg-[#112d86]/8 text-[#112d86] py-1.5 px-2.5 rounded-lg text-xs font-medium hover:bg-[#112d86]/15 transition-colors"
                        title={isRejected ? "Reeditar y corregir el documento" : "Regenerar documento"}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                        {isRejected ? "Reeditar" : "Regenerar"}
                      </button>
                      )}
                    </>
                  ) : item.template_id ? (
                    item.has_fields === false ? (
                      <button
                        onClick={() => handleAutoGenerate(item)}
                        disabled={generatingId === item.id}
                        className="inline-flex items-center gap-1.5 text-white py-1.5 px-3 rounded-lg text-xs font-semibold hover:shadow-md transition-all disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg, #c8a84e, #b09640)" }}
                        title="Generar automáticamente (sin campos)"
                      >
                        {generatingId === item.id ? (
                          <>
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Generando...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                            Generar
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleGenerate(item)}
                        className="inline-flex items-center gap-1.5 text-white py-1.5 px-3 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                        style={{ background: item.draft_values && Object.keys(item.draft_values).length > 0
                          ? "linear-gradient(135deg, #112d86, #1a3a9e)"
                          : "linear-gradient(135deg, #c8a84e, #b09640)"
                        }}
                      >
                        {item.draft_values && Object.keys(item.draft_values).length > 0 ? (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            Continuar
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            Generar
                          </>
                        )}
                      </button>
                    )
                    ) : (
                      <span className="text-xs text-[#112d86]/40 italic">Sin plantilla asignada</span>
                    )
                  }
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Anexos section (optional) */}
      {annexItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-[#c8a84e]/30 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#c8a84e]/20 flex items-center justify-between gap-3" style={{ background: "linear-gradient(135deg, #7a5c1e, #9a7030)" }}>
            <div>
              <h2 className="text-sm font-semibold text-white">{mainItems.length + 1}. Anexos</h2>
              <p className="text-[10px] text-white/60 mt-0.5">Documentos opcionales — seleccione los que correspondan</p>
            </div>
          </div>
          <div className="divide-y divide-[#c8a84e]/10">
            {annexItems
              .filter((item) => !search || item.template_name.toLowerCase().includes(search.toLowerCase()))
              .map((item, idx) => {
              const isRejected = item.submission_status === "rechazado";
              return (
              <div key={item.id} className={`px-5 py-4 ${item.is_approved ? "bg-green-50/60" : isRejected ? "bg-red-50/50" : item.is_completed ? "bg-green-50/40" : "bg-[#c8a84e]/[0.02]"}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
                    item.is_approved
                      ? "bg-green-200 text-green-800 border border-green-400"
                      : isRejected
                      ? "bg-red-100 text-red-700 border border-red-300"
                      : item.is_completed
                      ? "bg-green-100 text-green-700 border border-green-300"
                      : "bg-[#c8a84e]/15 text-[#7a5c1e] border border-[#c8a84e]/30"
                  }`}>
                    {isRejected ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : item.is_completed ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${isRejected ? "text-red-700" : item.is_completed ? "text-green-700" : "text-[#112d86]"}`}>
                        {item.template_name}
                      </p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#c8a84e]/15 text-[#7a5c1e] border border-[#c8a84e]/30 flex-shrink-0">
                        Opcional
                      </span>
                    </div>
                    {item.is_approved ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 mt-0.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                        Aprobado — documento bloqueado
                      </span>
                    ) : item.submission_status === "pendiente" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-600 mt-0.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Enviado — pendiente de validación
                      </span>
                    ) : isRejected ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 mt-0.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Rechazado — requiere corrección
                      </span>
                    ) : item.is_completed ? (
                      <p className="text-[10px] text-green-600/70 mt-0.5">Documento generado</p>
                    ) : item.draft_values && Object.keys(item.draft_values).length > 0 ? (
                      <p className="text-[10px] text-[#c8a84e] mt-0.5 font-medium">Borrador guardado</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {item.is_approved && item.docx_filename ? (
                      <>
                        <button onClick={() => handleDownload(getRepositoryDocxUrl(item.docx_filename), item.docx_filename)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }} title="Descargar Word">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Word
                        </button>
                        <button onClick={() => handleDownload(getRepositoryPdfUrl(item.docx_filename), item.docx_filename.replace(".docx", ".pdf"))} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }} title="Descargar PDF">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          PDF
                        </button>
                        {item.document_id && (
                          <button onClick={() => handlePreview(item.document_id)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }} title="Previsualizar">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            Ver
                          </button>
                        )}
                      </>
                    ) : item.is_completed && item.docx_filename ? (
                      <>
                        <button onClick={() => handleDownload(getRepositoryDocxUrl(item.docx_filename), item.docx_filename)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }} title="Descargar Word">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Word
                        </button>
                        <button onClick={() => handleDownload(getRepositoryPdfUrl(item.docx_filename), item.docx_filename.replace(".docx", ".pdf"))} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }} title="Descargar PDF">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          PDF
                        </button>
                        {item.document_id && (
                          <button onClick={() => handlePreview(item.document_id)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }} title="Previsualizar">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            Vista previa
                          </button>
                        )}
                        {isOperativo && !item.submission_status && (
                          <button onClick={() => handleSubmitDraft(item.document_id)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all disabled:opacity-50" style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }} title="Enviar para validación">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                            Enviar
                          </button>
                        )}
                        {isOperativo && item.submission_status === "pendiente" && (
                          <button onClick={() => handleModifyPending(item)} className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: "linear-gradient(135deg, #c8a84e, #b09640)" }} title="Modificar el contrato por un nuevo antecedente legal (requiere documento validador)">
                            Modificar con validador
                          </button>
                        )}
                        {item.submission_status !== "pendiente" && (
                        <button onClick={() => handleGenerate(item)} className="inline-flex items-center gap-1 bg-[#112d86]/8 text-[#112d86] py-1.5 px-2.5 rounded-lg text-xs font-medium hover:bg-[#112d86]/15 transition-colors" title={isRejected ? "Reeditar y corregir el documento" : "Regenerar documento"}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                          {isRejected ? "Reeditar" : "Regenerar"}
                        </button>
                        )}
                      </>
                    ) : item.template_id ? (
                      item.has_fields === false ? (
                        <button onClick={() => handleAutoGenerate(item)} disabled={generatingId === item.id} className="inline-flex items-center gap-1.5 text-white py-1.5 px-3 rounded-lg text-xs font-semibold hover:shadow-md transition-all disabled:opacity-60" style={{ background: "linear-gradient(135deg, #c8a84e, #b09640)" }} title="Generar automáticamente">
                          {generatingId === item.id ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Generando...</> : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>Generar</>}
                        </button>
                      ) : (
                      <button onClick={() => handleGenerate(item)} className="inline-flex items-center gap-1.5 text-white py-1.5 px-3 rounded-lg text-xs font-semibold hover:shadow-md transition-all" style={{ background: item.draft_values && Object.keys(item.draft_values).length > 0 ? "linear-gradient(135deg, #112d86, #1a3a9e)" : "linear-gradient(135deg, #c8a84e, #b09640)" }}>
                        {item.draft_values && Object.keys(item.draft_values).length > 0 ? (
                          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>Continuar</>
                        ) : (
                          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>Generar</>
                        )}
                      </button>
                      )
                    ) : (
                      <span className="text-xs text-[#112d86]/40 italic">Sin plantilla asignada</span>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#112d86]/10">
              <div>
                <h3 className="text-lg font-semibold text-[#112d86]">Vista previa del documento</h3>
                <p className="text-xs text-[#112d86]/40">Los campos ingresados están destacados en amarillo</p>
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

      {submitDocId && (
        <SubmitDraftModal
          documentId={submitDocId}
          showComment={false}
          onClose={() => setSubmitDocId(null)}
          onSubmitted={handleSubmitted}
        />
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate("/generate")}
          className="text-sm text-[#112d86]/60 hover:text-[#112d86] transition-colors flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Todos los expedientes
        </button>
        <button
          onClick={handleDownloadAllDocx}
          disabled={approvedCount === 0 || downloadingAllDocx}
          className="inline-flex items-center gap-2 text-white py-2.5 px-5 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
          title={approvedCount === 0 ? "No hay documentos aprobados aún" : "Descargar aprobados en Word"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloadingAllDocx ? "Descargando..." : `ZIP Word (${approvedCount})`}
        </button>
        <button
          onClick={handleDownloadAll}
          disabled={approvedCount === 0 || downloadingAll}
          className="inline-flex items-center gap-2 text-white py-2.5 px-5 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
          title={approvedCount === 0 ? "No hay documentos aprobados aún" : "Descargar aprobados en PDF"}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloadingAll ? "Descargando..." : `ZIP PDF (${approvedCount})`}
        </button>
      </div>
    </div>
  );
}
