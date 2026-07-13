import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";
import {
  getRepositoryDocuments,
  deleteRepositoryDocument,
  getRepositoryDocxUrl,
  getRepositoryPdfUrl,
  getAuthHeaderForDownload,
  submitDraft,
  getMySubmissions,
  getDocumentFields,
  getDocumentEvents,
  getPreviewPdfUrl,
} from "../services/api";

export default function Repository() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [documents, setDocuments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expedienteFilter, setExpedienteFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [jurisdiccionFilter, setJurisdiccionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedEventId, setExpandedEventId] = useState(null);
  const [eventsCache, setEventsCache] = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  async function loadDocuments() {
    setLoading(true);
    try {
      const [docs, subs] = await Promise.all([
        getRepositoryDocuments(),
        getMySubmissions(),
      ]);
      setDocuments(docs);
      setSubmissions(subs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  function getSubmissionStatus(docId) {
    const sub = submissions.find((s) => s.document_id === docId);
    return sub || null;
  }

  async function handleSubmitDraft(docId) {
    if (!await confirm("¿Enviar este documento como borrador para revisión de jefatura?", { confirmLabel: "Enviar", title: "Enviar borrador" })) return;
    try {
      await submitDraft(docId);
      toast("Borrador enviado exitosamente para revisión.", "success");
      loadDocuments();
    } catch (err) {
      toast("Error: " + err.message, "error");
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

  async function toggleEvents(docId) {
    if (expandedEventId === docId) {
      setExpandedEventId(null);
      return;
    }
    if (!eventsCache[docId]) {
      try {
        const events = await getDocumentEvents(docId);
        setEventsCache((prev) => ({ ...prev, [docId]: events }));
      } catch (err) {
        console.error(err);
      }
    }
    setExpandedEventId(docId);
  }

  async function handleDelete(docId, name) {
    if (!await confirm(`¿Eliminar el documento "${name}"?`, { confirmLabel: "Eliminar", danger: true, title: "Eliminar documento" })) return;
    try {
      await deleteRepositoryDocument(docId);
      toast("Documento eliminado.", "success");
      loadDocuments();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  async function handleEditDocument(doc) {
    try {
      const data = await getDocumentFields(doc.id);
      navigate(`/generate/${data.template_id || ""}`, {
        state: { editData: data },
      });
    } catch (err) {
      toast("Error al cargar datos del documento: " + err.message, "error");
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

  async function handleResubmitCorrected(doc) {
    try {
      const fieldsData = await getDocumentFields(doc.id);
      const editData = {
        id: doc.id,
        document_type: doc.document_type,
        template_id: doc.template_id_ref,
        field_values: fieldsData.field_values,
      };
      navigate(`/generate/${doc.template_id_ref || ""}`, { state: { editData, correctionDocId: doc.id } });
    } catch (err) {
      toast("Error al cargar el documento: " + err.message, "error");
    }
  }

  // Unique expedientes for pills
  const expedientes = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const doc of documents) {
      if (doc.bundle_correlativo != null && !seen.has(doc.bundle_correlativo)) {
        seen.add(doc.bundle_correlativo);
        list.push({ correlativo: doc.bundle_correlativo, bundle_id: doc.bundle_id });
      }
    }
    return list.sort((a, b) => a.correlativo - b.correlativo);
  }, [documents]);

  // Filter by expediente
  const expedienteFiltered = useMemo(() => {
    if (expedienteFilter === "all") return documents;
    if (expedienteFilter === "sin-expediente") return documents.filter((d) => d.bundle_correlativo == null);
    return documents.filter((d) => String(d.bundle_correlativo) === expedienteFilter);
  }, [documents, expedienteFilter]);

  // Filter by status — borradores (sin submission) nunca se muestran
  const statusFiltered = useMemo(() => {
    return expedienteFiltered.filter((d) => {
      const sub = submissions.find((s) => s.document_id === d.id);
      if (!sub) return false; // excluir borradores
      if (statusFilter === "all") return true;
      return sub.status === statusFilter;
    });
  }, [expedienteFiltered, statusFilter, submissions]);

  // Unique categories and jurisdicciones for dropdowns
  const categoryOptions = useMemo(() => {
    const seen = new Set();
    return documents.map((d) => d.category_name).filter((c) => c && !seen.has(c) && seen.add(c)).sort();
  }, [documents]);

  const jurisdiccionOptions = useMemo(() => {
    const seen = new Set();
    return documents.map((d) => d.jurisdiccion).filter((j) => j && !seen.has(j) && seen.add(j)).sort();
  }, [documents]);

  // Filter by category
  const categoryFiltered = useMemo(() => {
    if (categoryFilter === "all") return statusFiltered;
    return statusFiltered.filter((d) => d.category_name === categoryFilter);
  }, [statusFiltered, categoryFilter]);

  // Filter by jurisdicción
  const jurisdiccionFiltered = useMemo(() => {
    if (jurisdiccionFilter === "all") return categoryFiltered;
    return categoryFiltered.filter((d) => d.jurisdiccion === jurisdiccionFilter);
  }, [categoryFiltered, jurisdiccionFilter]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return jurisdiccionFiltered;
    const q = search.trim().toLowerCase();
    return jurisdiccionFiltered.filter((d) => d.document_name.toLowerCase().includes(q));
  }, [jurisdiccionFiltered, search]);

  const statusCounts = useMemo(() => {
    const counts = { pendiente: 0, aprobado: 0, rechazado: 0, borrador: 0 };
    for (const doc of documents) {
      const sub = submissions.find((s) => s.document_id === doc.id);
      if (!sub) counts.borrador++;
      else if (sub.status === "pendiente") counts.pendiente++;
      else if (sub.status === "aprobado") counts.aprobado++;
      else if (sub.status === "rechazado") counts.rechazado++;
    }
    return counts;
  }, [documents, submissions]);

  function getSubmissionHistory(docId) {
    return submissions
      .filter((s) => s.document_id === docId)
      .slice()
      .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
  }

  function renderDocRow(doc) {
    const sub = getSubmissionStatus(doc.id);
    const isOp = user?.role === "operativo";
    const isApproved = sub?.status === "aprobado";
    const canDownload = !isOp || isApproved;
    const isRejected = sub?.status === "rechazado";
    const showEdit = !isApproved && (isRejected || !sub);
    const isExpanded = expandedEventId === doc.id;
    const events = eventsCache[doc.id] || [];
    const history = getSubmissionHistory(doc.id);

    return (
      <tr key={doc.id} className="border-t border-[#1a2d56]/5 hover:bg-[#1a2d56]/[0.02] align-top">
        <td className="py-3 px-4">
          <div className="font-medium text-[#1a2d56] text-sm">{doc.document_name}</div>
          {doc.template_name && (
            <div className="text-xs text-[#1a2d56]/40 mt-0.5">Plantilla: {doc.template_name}</div>
          )}
          {doc.bundle_id && (
            <a
              href={`/expediente/${doc.bundle_id}`}
              onClick={(e) => { e.stopPropagation(); navigate(`/expediente/${doc.bundle_id}`); e.preventDefault(); }}
              className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-[#c8a84e] hover:text-[#b09640] transition-colors"
              title="Ver expediente asociado"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              Expediente N° {doc.bundle_correlativo}
            </a>
          )}
        </td>
        <td className="py-3 px-4">
          <span className="inline-block text-xs font-medium px-2.5 py-0.5 rounded-full bg-[#1a2d56]/10 text-[#1a2d56]">
            Documento
          </span>
        </td>
        <td className="py-3 px-4 text-xs text-[#1a2d56]/50">{doc.category_name || "—"}</td>
        <td className="py-3 px-4 text-xs text-[#1a2d56]/60">
          {doc.jurisdiccion || <span className="text-[#1a2d56]/25">—</span>}
        </td>
        <td className="py-3 px-4 text-xs text-[#1a2d56]/40">
          {new Date(doc.created_at).toLocaleDateString("es-CL", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
        </td>
        <td className="py-3 px-4">
          <button
            onClick={() => toggleEvents(doc.id)}
            className="flex items-center gap-1.5 group"
            title="Ver trazabilidad del documento"
          >
            <svg className={`w-3.5 h-3.5 text-[#1a2d56]/40 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {isOp ? (
              <>
                {sub?.status === "pendiente" && (
                  <span className="inline-block bg-yellow-100 text-yellow-700 py-1 px-2.5 rounded-full text-xs font-medium border border-yellow-300">
                    Pendiente de revisión
                  </span>
                )}
                {isApproved && (
                  <span className="inline-block bg-green-100 text-green-700 py-1 px-2.5 rounded-full text-xs font-medium border border-green-300">
                    Aprobado
                  </span>
                )}
                {isRejected && (
                  <div>
                    <span className="inline-block bg-red-100 text-red-600 py-1 px-2.5 rounded-full text-xs font-medium border border-red-300">
                      Rechazado
                    </span>
                    {sub.comment && (
                      <div className="mt-1.5 bg-red-50 border border-red-200 rounded-lg p-2 max-w-xs">
                        <p className="text-[10px] font-semibold text-red-600 mb-0.5">Observación del revisor:</p>
                        <p className="text-xs text-red-700">{sub.comment}</p>
                      </div>
                    )}
                  </div>
                )}
                {!sub && (
                  <span className="inline-block bg-gray-100 text-[#1a2d56]/50 py-1 px-2.5 rounded-full text-xs font-medium border border-gray-200">
                    Borrador
                  </span>
                )}
              </>
            ) : (
              <span className="inline-block bg-gray-100 text-[#1a2d56]/50 py-1 px-2.5 rounded-full text-xs font-medium border border-gray-200">
                Ver trazabilidad
              </span>
            )}
          </button>
          {isExpanded && history.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {history.map((s) => (
                <div key={s.id} className="flex items-start gap-2 bg-[#1a2d56]/[0.02] border border-[#1a2d56]/8 rounded-lg px-2.5 py-2">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 flex-shrink-0">
                    Envío #{s.submission_number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        s.status === "aprobado" ? "bg-green-100 text-green-700" :
                        s.status === "rechazado" ? "bg-red-100 text-red-600" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                      <span className="text-[10px] text-[#1a2d56]/30">
                        {new Date(s.submitted_at).toLocaleDateString("es-CL", {
                          day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {s.submitter_comment && (
                      <p className="text-[10px] text-[#1a2d56]/60 mt-1">
                        <span className="font-semibold">Mi comentario:</span> {s.submitter_comment}
                      </p>
                    )}
                    {s.comment && (
                      <p className="text-[10px] text-red-700 mt-0.5">
                        <span className="font-semibold">Observación del revisor:</span> {s.comment}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {isExpanded && (
            <div className="mt-2 ml-1 border-l-2 border-[#c8a84e]/40 pl-3 space-y-2 py-1">
              {events.length === 0 ? (
                <p className="text-xs text-[#1a2d56]/40 italic">Sin registros de trazabilidad.</p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-2">
                    <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      ev.action === "creado" ? "bg-blue-400" :
                      ev.action === "enviado" ? "bg-yellow-400" :
                      ev.action === "aprobado" ? "bg-green-500" :
                      ev.action === "rechazado" ? "bg-red-500" :
                      ev.action === "corregido" ? "bg-violet-500" :
                      ev.action === "resubido" ? "bg-purple-400" :
                      "bg-gray-400"
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs text-[#1a2d56] leading-tight">
                        <span className="font-semibold capitalize">{ev.action}</span>
                        {ev.actor_name && <span className="text-[#1a2d56]/50"> — {ev.actor_name}</span>}
                        {ev.actor_role && <span className="text-[#1a2d56]/40"> ({ev.actor_role})</span>}
                      </p>
                      {ev.detail && <p className="text-[10px] text-[#1a2d56]/40 leading-tight">{ev.detail}</p>}
                      <p className="text-[10px] text-[#1a2d56]/30">
                        {new Date(ev.created_at).toLocaleDateString("es-CL", {
                          day: "2-digit", month: "2-digit", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </td>
        <td className="py-3 px-4 text-right">
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            {showEdit && (
              <button
                onClick={() => handleResubmitCorrected(doc)}
                className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
                title="Corregir el documento y reenviarlo a validación"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                Corregir y reenviar
              </button>
            )}
            {canDownload && (
              <>
                <button
                  onClick={() => handleDownload(getRepositoryDocxUrl(doc.docx_filename), doc.docx_filename)}
                  className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                  style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
                  title="Descargar Word"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Word
                </button>
                <button
                  onClick={() => handleDownload(getRepositoryPdfUrl(doc.docx_filename), doc.docx_filename.replace(".docx", ".pdf"))}
                  className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                  style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
                  title="Descargar PDF"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  PDF
                </button>
              </>
            )}
            <button
              onClick={() => handlePreview(doc.id)}
              className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
              style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
              title="Ver documento"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Ver
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const isOp = user?.role === "operativo";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a2d56]">
          {isOp ? "Mando de Control" : "Repositorio Personal"}
        </h1>
        <p className="text-sm text-[#1a2d56]/60 mt-1">
          {isOp
            ? "Resumen ejecutivo de sus Bases y Cronogramas"
            : "Historial de documentos generados en su cuenta"}
        </p>
      </div>

      {/* Status filter cards (operativo only) */}
      {isOp && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { key: "all",       label: "Total",           count: statusCounts.pendiente + statusCounts.aprobado + statusCounts.rechazado, border: "border-[#1a2d56]/10",  activeBorder: "border-[#1a2d56]",  bg: "bg-white",       activeBg: "bg-[#1a2d56]/5",   text: "text-[#1a2d56]",  subText: "text-[#1a2d56]/60"   },
            { key: "pendiente", label: "En validación",   count: statusCounts.pendiente,   border: "border-yellow-200",    activeBorder: "border-yellow-500", bg: "bg-yellow-50",   activeBg: "bg-yellow-100",    text: "text-yellow-700", subText: "text-yellow-700/80"  },
            { key: "aprobado",  label: "Aprobados",       count: statusCounts.aprobado,    border: "border-green-200",     activeBorder: "border-green-600",  bg: "bg-green-50",    activeBg: "bg-green-100",     text: "text-green-700",  subText: "text-green-700/80"   },
            { key: "rechazado", label: "Rechazados",      count: statusCounts.rechazado,   border: "border-red-200",       activeBorder: "border-red-500",    bg: "bg-red-50",      activeBg: "bg-red-100",       text: "text-red-700",    subText: "text-red-700/80"     },
          ].map(({ key, label, count, border, activeBorder, bg, activeBg, text, subText }) => {
            const isActive = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(isActive && key !== "all" ? "all" : key)}
                className={`p-4 rounded-xl border-2 text-left transition-all duration-150 w-full ${
                  isActive ? `${activeBorder} ${activeBg} shadow-sm` : `${border} ${bg} hover:shadow-sm`
                }`}
                title={isActive && key !== "all" ? "Clic para quitar filtro" : `Filtrar: ${label}`}
              >
                <p className={`text-2xl font-bold ${text}`}>{count}</p>
                <div className="flex items-center gap-1 mt-1">
                  <p className={`text-xs ${subText}`}>{label}</p>
                  {isActive && key !== "all" && (
                    <span className={`text-[10px] font-semibold px-1 rounded ${text} bg-white/60`}>✕</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Expediente filter pills */}
      {expedientes.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-[#1a2d56]/50 uppercase tracking-wider mr-1">Expediente:</span>
          {[{ label: "Todos", value: "all" }, ...expedientes.map((e) => ({ label: `N° ${e.correlativo}`, value: String(e.correlativo) })), { label: "Sin expediente", value: "sin-expediente" }].map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setExpedienteFilter(value)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                expedienteFilter === value
                  ? "bg-[#1a2d56] text-white border-[#1a2d56]"
                  : "bg-white text-[#1a2d56]/60 border-[#1a2d56]/20 hover:border-[#1a2d56]/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search + category/jurisdicción filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1a2d56]/30"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre de documento..."
            className="w-full pl-10 pr-4 py-2.5 border border-[#1a2d56]/15 rounded-xl text-sm focus:ring-2 focus:ring-[#1a2d56]/20 focus:border-[#1a2d56]/30 bg-white"
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1a2d56]/30 hover:text-[#1a2d56]/60 text-sm">
              Limpiar
            </button>
          )}
        </div>
        {categoryOptions.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="py-2.5 px-3 border border-[#1a2d56]/15 rounded-xl text-sm bg-white focus:ring-2 focus:ring-[#1a2d56]/20 focus:border-[#1a2d56]/30 text-[#1a2d56]"
          >
            <option value="all">Todas las categorías</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {jurisdiccionOptions.length > 0 && (
          <select
            value={jurisdiccionFilter}
            onChange={(e) => setJurisdiccionFilter(e.target.value)}
            className="py-2.5 px-3 border border-[#1a2d56]/15 rounded-xl text-sm bg-white focus:ring-2 focus:ring-[#1a2d56]/20 focus:border-[#1a2d56]/30 text-[#1a2d56]"
          >
            <option value="all">Todas las jurisdicciones</option>
            {jurisdiccionOptions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        )}
      </div>

      {/* Documents table */}
      {loading ? (
        <div className="text-center py-8 text-[#1a2d56]/50">Cargando documentos...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-[#1a2d56]/20 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-[#1a2d56]/60 text-sm">
            {search
              ? `No se encontraron documentos para "${search}".`
              : "Aún no ha generado documentos."}
          </p>
        </div>
      ) : (
        (() => {
          // Group by bundle_correlativo
          const groups = [];
          const seen = new Map();
          for (const doc of filtered) {
            const key = doc.bundle_correlativo != null ? String(doc.bundle_correlativo) : "__sin__";
            if (!seen.has(key)) {
              seen.set(key, { correlativo: doc.bundle_correlativo, bundle_id: doc.bundle_id, category_name: doc.category_name, docs: [] });
              groups.push(key);
            }
            seen.get(key).docs.push(doc);
          }
          const tableHead = (
            <thead style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}>
              <tr>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Documento</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-28">Tipo</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-32">Categoría</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-32">Jurisdicción</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-36">Fecha</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-96">Estado / Trazabilidad</th>
                <th className="py-3.5 px-4 text-right text-[11px] font-semibold text-white/90 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
          );
          if (groups.length === 1) {
            return (
              <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 overflow-hidden">
                <table className="w-full">{tableHead}<tbody>{seen.get(groups[0]).docs.map((doc) => renderDocRow(doc))}</tbody></table>
              </div>
            );
          }
          return (
            <div className="space-y-4">
              {groups.map((key) => {
                const group = seen.get(key);
                return (
                  <div key={key} className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 overflow-hidden">
                    {key !== "__sin__" ? (
                      <button
                        onClick={() => navigate(`/expediente/${group.bundle_id}`)}
                        className="w-full flex items-center gap-3 px-5 py-3 bg-[#1a2d56]/[0.04] hover:bg-[#1a2d56]/[0.08] border-b border-[#1a2d56]/10 transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-[#c8a84e] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <span className="text-sm font-bold text-[#1a2d56]">Expediente N° {group.correlativo}</span>
                        {group.category_name && <span className="text-xs text-[#1a2d56]/50">— {group.category_name}</span>}
                        <svg className="w-3.5 h-3.5 text-[#1a2d56]/30 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-3 bg-[#1a2d56]/[0.02] border-b border-[#1a2d56]/10">
                        <span className="text-sm font-semibold text-[#1a2d56]/50">Sin expediente asociado</span>
                      </div>
                    )}
                    <table className="w-full">{tableHead}<tbody>{group.docs.map((doc) => renderDocRow(doc))}</tbody></table>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

      {/* Preview modal */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a2d56]/10">
              <div>
                <h3 className="text-lg font-semibold text-[#1a2d56]">Vista previa del documento</h3>
                <p className="text-xs text-[#1a2d56]/40">Los campos ingresados están destacados en amarillo</p>
              </div>
              <button
                onClick={() => { setShowPreview(false); URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                className="text-[#1a2d56]/40 hover:text-[#1a2d56] text-xl font-bold px-2"
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
    </div>
  );
}
