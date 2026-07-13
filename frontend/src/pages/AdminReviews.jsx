import { useState, useEffect, useMemo, Fragment } from "react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";
import {
  getPendingReviews,
  reviewDraft,
  reuploadDocument,
  getRepositoryDocxUrl,
  getRepositoryPdfUrl,
  getPreviewPdfUrl,
  getAuthHeaderForDownload,
  getDocumentEvents,
} from "../services/api";

export default function AdminReviews() {
  const toast = useToast();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [commentModal, setCommentModal] = useState(null);
  const [comment, setComment] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [eventsCache, setEventsCache] = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  async function loadReviews() {
    setLoading(true);
    try {
      const data = await getPendingReviews();
      setReviews(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReviews();
  }, []);

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

  async function handleApprove(id) {
    if (!await confirm("¿Aprobar este borrador?", { confirmLabel: "Aprobar", title: "Aprobar documento" })) return;
    try {
      await reviewDraft(id, "aprobado");
      toast("Documento aprobado.", "success");
      loadReviews();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  function openRejectModal(id) {
    setCommentModal(id);
    setComment("");
  }

  async function handleReject() {
    if (!commentModal) return;
    try {
      await reviewDraft(commentModal, "rechazado", comment);
      toast("Documento rechazado.", "warning");
      setCommentModal(null);
      loadReviews();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  async function handleReupload(submissionId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await reuploadDocument(submissionId, file);
        toast("Documento actualizado exitosamente.", "success");
        loadReviews();
      } catch (err) {
        toast("Error: " + err.message, "error");
      }
    };
    input.click();
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

  // Filter by status
  const statusFiltered = useMemo(() => {
    if (filter === "all") return reviews;
    return reviews.filter((r) => r.status === filter);
  }, [reviews, filter]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return statusFiltered;
    const q = search.trim().toLowerCase();
    return statusFiltered.filter(
      (r) =>
        r.document_name.toLowerCase().includes(q) ||
        r.submitter_name.toLowerCase().includes(q)
    );
  }, [statusFiltered, search]);

  async function handleExpand(review) {
    const id = review.id;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    if (!eventsCache[review.document_id] && review.document_id) {
      try {
        const events = await getDocumentEvents(review.document_id);
        setEventsCache((prev) => ({ ...prev, [review.document_id]: events }));
      } catch (err) {
        console.error(err);
      }
    }
    setExpandedId(id);
  }

  const countPending = reviews.filter((r) => r.status === "pendiente").length;
  const countApproved = reviews.filter((r) => r.status === "aprobado").length;
  const countRejected = reviews.filter((r) => r.status === "rechazado").length;

  function renderFieldValues(fieldValues) {
    if (!fieldValues || typeof fieldValues !== "object") return null;
    const entries = Object.entries(fieldValues).filter(
      ([, v]) => v && String(v).trim()
    );
    if (entries.length === 0) return null;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="py-1">
            <span className="text-xs font-medium text-[#1a2d56]/50 block">
              {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            <span className="text-sm text-[#1a2d56]">{String(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1a2d56]">
          Revisión de Borradores
        </h1>
        <p className="text-sm text-[#1a2d56]/60 mt-1">
          Revise y valide los documentos enviados por los operativos
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <button
          onClick={() => setFilter("all")}
          className={`p-4 rounded-xl border-2 transition-all text-left ${
            filter === "all"
              ? "border-[#1a2d56] bg-[#1a2d56]/5"
              : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/20"
          }`}
        >
          <p className="text-2xl font-bold text-[#1a2d56]">{reviews.length}</p>
          <p className="text-xs text-[#1a2d56]/60 mt-1">Total</p>
        </button>
        <button
          onClick={() => setFilter("pendiente")}
          className={`p-4 rounded-xl border-2 transition-all text-left ${
            filter === "pendiente"
              ? "border-yellow-500 bg-yellow-50"
              : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/20"
          }`}
        >
          <p className="text-2xl font-bold text-yellow-600">{countPending}</p>
          <p className="text-xs text-[#1a2d56]/60 mt-1">Pendientes</p>
        </button>
        <button
          onClick={() => setFilter("aprobado")}
          className={`p-4 rounded-xl border-2 transition-all text-left ${
            filter === "aprobado"
              ? "border-green-500 bg-green-50"
              : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/20"
          }`}
        >
          <p className="text-2xl font-bold text-green-600">{countApproved}</p>
          <p className="text-xs text-[#1a2d56]/60 mt-1">Aprobados</p>
        </button>
        <button
          onClick={() => setFilter("rechazado")}
          className={`p-4 rounded-xl border-2 transition-all text-left ${
            filter === "rechazado"
              ? "border-red-500 bg-red-50"
              : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/20"
          }`}
        >
          <p className="text-2xl font-bold text-red-600">{countRejected}</p>
          <p className="text-xs text-[#1a2d56]/60 mt-1">Rechazados</p>
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1a2d56]/30"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por documento o nombre del operativo..."
          className="w-full pl-10 pr-4 py-2.5 border border-[#1a2d56]/15 rounded-xl text-sm focus:ring-2 focus:ring-[#1a2d56]/20 focus:border-[#1a2d56]/30 bg-white"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#1a2d56]/30 hover:text-[#1a2d56]/60 text-sm"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Reviews table */}
      {loading ? (
        <div className="text-center py-8 text-[#1a2d56]/50">
          Cargando revisiones...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-10 text-center">
          <p className="text-[#1a2d56]/60">
            {search
              ? `No se encontraron resultados para "${search}".`
              : `No hay borradores ${filter !== "all" ? `con estado "${filter}"` : "para mostrar"}.`}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 overflow-hidden">
          <table className="w-full">
            <thead style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}>
              <tr>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">
                  Documento
                </th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">
                  Enviado por
                </th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-28">
                  Jurisdicción
                </th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-28">
                  Estado
                </th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider w-36">
                  Fecha envío
                </th>
                <th className="py-3.5 px-4 text-right text-[11px] font-semibold text-white/90 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={`border-t border-[#1a2d56]/5 hover:bg-[#1a2d56]/[0.02] cursor-pointer ${
                      expandedId === r.id ? "bg-[#1a2d56]/[0.03]" : ""
                    }`}
                    onClick={() => handleExpand(r)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <div className="font-medium text-[#1a2d56] text-sm">
                          {r.document_name}
                        </div>
                        {r.submission_number > 1 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 flex-shrink-0"
                            title="Este documento ya fue reenviado tras una corrección"
                          >
                            Envío #{r.submission_number}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#1a2d56]/40 mt-0.5">
                        {r.document_type === "base" ? "Base" : "Cronograma"}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm text-[#1a2d56]">
                        {r.submitter_name}
                      </div>
                      <div className="text-xs text-[#1a2d56]/40">
                        {r.submitter_email}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#1a2d56]/60">
                      {r.jurisdiccion || <span className="text-[#1a2d56]/25">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full ${
                          r.status === "pendiente"
                            ? "bg-yellow-100 text-yellow-700"
                            : r.status === "aprobado"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-600"
                        }`}
                      >
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                      {r.comment && (
                        <div className="text-xs text-[#1a2d56]/40 mt-1 italic">
                          {r.comment}
                        </div>
                      )}
                      {r.submitter_comment && (
                        <div className="mt-1.5 bg-blue-50 border border-blue-200 rounded p-1.5 max-w-xs">
                          <p className="text-[10px] font-semibold text-blue-700">Comentario del solicitante:</p>
                          <p className="text-xs text-blue-800">{r.submitter_comment}</p>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#1a2d56]/40">
                      {new Date(r.submitted_at).toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td
                      className="py-3 px-4 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {r.docx_filename && (
                          <>
                            {r.document_id && (
                              <button
                                onClick={() => handlePreview(r.document_id)}
                                className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                                style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
                                title="Ver documento con campos destacados"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                Revisar
                              </button>
                            )}
                            <button
                              onClick={() =>
                                handleDownload(
                                  getRepositoryDocxUrl(r.docx_filename),
                                  r.docx_filename
                                )
                              }
                              className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                              style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
                              title="Descargar Word para revisar y editar"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                              Word
                            </button>
                            <button
                              onClick={() =>
                                handleDownload(
                                  getRepositoryPdfUrl(r.docx_filename),
                                  r.docx_filename.replace(".docx", ".pdf")
                                )
                              }
                              className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                              style={{ background: "linear-gradient(135deg, #8b2332, #a12a3d)" }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                              PDF
                            </button>
                          </>
                        )}
                        {r.status === "pendiente" && (
                          <>
                            <button
                              onClick={() => handleReupload(r.id)}
                              className="inline-flex items-center gap-1 bg-[#c8a84e]/10 text-[#8a7232] py-1.5 px-2.5 rounded-lg text-xs font-medium hover:bg-[#c8a84e]/20 transition-colors border border-[#c8a84e]/25"
                              title="Subir documento Word editado"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                              Resubir
                            </button>
                            <button
                              onClick={() => handleApprove(r.id)}
                              className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                              style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Aprobar
                            </button>
                            <button
                              onClick={() => openRejectModal(r.id)}
                              className="inline-flex items-center gap-1 text-white py-1.5 px-2.5 rounded-lg text-xs font-semibold hover:shadow-md transition-all"
                              style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)" }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Rechazar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expandable detail panel */}
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td
                        colSpan={6}
                        className="bg-[#1a2d56]/[0.02] px-6 py-4 border-t border-[#1a2d56]/5"
                      >
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-[#1a2d56]">
                            Datos ingresados por el operativo
                          </h4>
                          {r.field_values &&
                          Object.keys(r.field_values).length > 0 ? (
                            renderFieldValues(r.field_values)
                          ) : (
                            <p className="text-xs text-[#1a2d56]/40 italic">
                              No hay datos de formulario disponibles para este
                              documento.
                            </p>
                          )}
                          {r.reviewer_name && (
                            <div className="pt-2 border-t border-[#1a2d56]/10">
                              <span className="text-xs text-[#1a2d56]/50">
                                Revisado por:{" "}
                                <span className="font-medium text-[#1a2d56]">
                                  {r.reviewer_name}
                                </span>
                                {r.reviewed_at && (
                                  <>
                                    {" "}
                                    el{" "}
                                    {new Date(
                                      r.reviewed_at
                                    ).toLocaleDateString("es-CL", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </>
                                )}
                              </span>
                            </div>
                          )}
                          {/* Traceability timeline */}
                          {eventsCache[r.document_id] && eventsCache[r.document_id].length > 0 && (
                            <div className="pt-2 border-t border-[#1a2d56]/10">
                              <h4 className="text-xs font-semibold text-[#1a2d56]/60 mb-2">Trazabilidad del documento</h4>
                              <div className="border-l-2 border-[#c8a84e]/40 pl-3 space-y-2">
                                {eventsCache[r.document_id].map((ev) => (
                                  <div key={ev.id} className="flex items-start gap-2">
                                    <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                                      ev.action === "creado" ? "bg-blue-400" :
                                      ev.action === "enviado" ? "bg-yellow-400" :
                                      ev.action === "aprobado" ? "bg-green-500" :
                                      ev.action === "rechazado" ? "bg-red-500" :
                                      ev.action === "desierta" ? "bg-[#c8a84e]" :
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
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a2d56]/10">
              <div>
                <h3 className="text-lg font-semibold text-[#1a2d56]">Revisión de documento</h3>
                <p className="text-xs text-[#1a2d56]/40">Los campos ingresados están destacados en amarillo</p>
              </div>
              <button
                onClick={() => { setShowPreview(false); URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }}
                className="text-[#1a2d56]/40 hover:text-[#1a2d56] text-xl font-bold px-2"
              >
                X
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                src={previewUrl + "#toolbar=0&navpanes=0&scrollbar=1"}
                className="w-full h-full border-0"
                title="Revisión del documento"
              />
            </div>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {commentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold text-[#1a2d56]">
              Rechazar borrador
            </h3>
            <div>
              <label className="block text-sm font-medium text-[#1a2d56] mb-1">
                Comentario (opcional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
                placeholder="Indique el motivo del rechazo..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCommentModal(null)}
                className="px-4 py-2 text-sm text-[#1a2d56]/60 hover:text-[#1a2d56] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleReject}
                className="bg-red-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
