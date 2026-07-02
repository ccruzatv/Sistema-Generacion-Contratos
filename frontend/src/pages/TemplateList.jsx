import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { getCategories, getTemplates, deleteTemplate, createCategory, renameCategory, deleteCategory } from "../services/api";
import { useAuth } from "../context/AuthContext";
import UploadTemplate from "../components/UploadTemplate";

// Small inline modal for create/rename
function NameModal({ title, initial = "", onConfirm, onClose }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <h3 className="text-base font-semibold text-[#1a2d56] mb-4">{title}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Nombre de la carpeta"
            className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2d56]/30"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#1a2d56]/60 hover:text-[#1a2d56] transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 transition-all"
              style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TemplateList() {
  const { isSuperAdmin } = useAuth();
  const [biddingTypes, setBiddingTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedSub, setSelectedSub] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  // Modal state: { mode: "create-type"|"create-sub"|"rename", target: category|null }
  const [modal, setModal] = useState(null);
  const [actionError, setActionError] = useState("");

  async function loadBiddingTypes() {
    try {
      const data = await getCategories(true);
      setBiddingTypes(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  async function loadTemplates(categoryId) {
    setLoading(true);
    try {
      const data = await getTemplates(categoryId);
      setTemplates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBiddingTypes();
    loadTemplates();
  }, []);

  function handleSelectType(bt) {
    if (selectedType?.id === bt.id) {
      setSelectedType(null);
      setSelectedSub(null);
      loadTemplates();
    } else {
      setSelectedType(bt);
      setSelectedSub(null);
      loadTemplates();
    }
  }

  function handleSelectSub(sub) {
    if (selectedSub?.id === sub.id) {
      setSelectedSub(null);
      loadTemplates();
    } else {
      setSelectedSub(sub);
      loadTemplates(sub.id);
    }
  }

  async function handleDeleteTemplate(id, name) {
    if (!confirm(`¿Eliminar la plantilla "${name}"?`)) return;
    try {
      await deleteTemplate(id);
      loadTemplates(selectedSub?.id);
      loadBiddingTypes();
    } catch (err) {
      alert("Error: " + err.message);
    }
  }

  // ── Category management ──

  async function handleModalConfirm(name) {
    setActionError("");
    try {
      if (modal.mode === "create-type") {
        await createCategory({ name, parent_id: null });
      } else if (modal.mode === "create-sub") {
        await createCategory({ name, parent_id: selectedType.id });
      } else if (modal.mode === "rename") {
        await renameCategory(modal.target.id, name);
      }
      const fresh = await loadBiddingTypes();
      // Sync selectedType and selectedSub to updated objects
      if (selectedType) {
        const updatedType = fresh.find((bt) => bt.id === selectedType.id);
        setSelectedType(updatedType || null);
        if (selectedSub && updatedType) {
          const updatedSub = updatedType.children?.find((c) => c.id === selectedSub.id);
          setSelectedSub(updatedSub || null);
        }
      }
      setModal(null);
    } catch (err) {
      setActionError(err.message || "Error al guardar");
    }
  }

  async function handleDeleteCategory(cat, isType) {
    const label = isType ? `el tipo de contrato "${cat.name}"` : `la subcarpeta "${cat.name}"`;
    if (!confirm(`¿Eliminar ${label}? Esta acción no se puede deshacer.`)) return;
    setActionError("");
    try {
      await deleteCategory(cat.id);
      const fresh = await loadBiddingTypes();
      if (isType) {
        setSelectedType(null);
        setSelectedSub(null);
        loadTemplates();
      } else {
        const updatedType = fresh.find((bt) => bt.id === selectedType?.id);
        setSelectedType(updatedType || null);
        setSelectedSub(null);
        loadTemplates();
      }
    } catch (err) {
      alert(err.message || "No se puede eliminar esta carpeta");
    }
  }

  const subcategories = selectedType?.children || [];

  return (
    <div className="space-y-6">
      {modal && (
        <NameModal
          title={
            modal.mode === "create-type" ? "Nuevo tipo de contrato" :
            modal.mode === "create-sub" ? `Nueva subcarpeta en "${selectedType?.name}"` :
            `Renombrar "${modal.target?.name}"`
          }
          initial={modal.mode === "rename" ? modal.target?.name : ""}
          onConfirm={handleModalConfirm}
          onClose={() => { setModal(null); setActionError(""); }}
        />
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2d56]">Plantillas de Contratos</h1>
          <p className="text-sm text-[#1a2d56]/60 mt-1">
            {selectedSub
              ? `${selectedType.name} / ${selectedSub.name}`
              : selectedType
              ? `Tipo: ${selectedType.name} — Seleccione una subcarpeta`
              : "Seleccione un tipo de contrato para ver sus subcarpetas"}
          </p>
          {actionError && <p className="text-xs text-red-500 mt-1">{actionError}</p>}
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              {showUpload ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />}
            </svg>
            {showUpload ? "Cerrar" : "Cargar Plantilla"}
          </button>
        )}
      </div>

      {isSuperAdmin && showUpload && (
        <UploadTemplate
          biddingTypes={biddingTypes}
          selectedTypeId={selectedType?.id || null}
          selectedSubId={selectedSub?.id || null}
          onCreated={() => {
            setShowUpload(false);
            loadTemplates(selectedSub?.id);
            loadBiddingTypes();
          }}
        />
      )}

      {/* Tipos de Licitación */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-[#1a2d56]/50 uppercase tracking-wider">Tipos de Contrato</h2>
          {isSuperAdmin && (
            <button
              onClick={() => setModal({ mode: "create-type" })}
              className="flex items-center gap-1 text-xs font-medium text-[#1a2d56] hover:text-[#c8a84e] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              Nuevo tipo
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {biddingTypes.map((bt) => {
            const totalTemplates = (bt.children || []).reduce((sum, ch) => sum + (ch.template_count || 0), 0);
            const isSelected = selectedType?.id === bt.id;
            return (
              <div key={bt.id} className="relative group">
                <button
                  onClick={() => handleSelectType(bt)}
                  className={`w-full h-full flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all ${
                    isSelected
                      ? "border-[#c8a84e] bg-[#c8a84e]/5 shadow-md"
                      : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/25 hover:shadow-md"
                  }`}
                >
                  <div
                    className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                      isSelected ? "bg-[#c8a84e]/15" : "bg-[#1a2d56]/6"
                    }`}
                  >
                    <svg
                      className={`w-6 h-6 ${isSelected ? "text-[#c8a84e]" : "text-[#1a2d56]/45"}`}
                      fill="currentColor" viewBox="0 0 24 24"
                    >
                      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                    </svg>
                  </div>
                  <div className="min-w-0 pt-1">
                    <p className="text-[13px] font-normal text-[#1a2d56] leading-relaxed text-justify">
                      {bt.name}
                    </p>
                    <p className="text-[11px] text-[#1a2d56]/40 mt-2">
                      {totalTemplates} plantilla{totalTemplates !== 1 ? "s" : ""}
                    </p>
                  </div>
                </button>
                {isSuperAdmin && (
                  <div className="absolute top-2.5 right-2.5 hidden group-hover:flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setModal({ mode: "rename", target: bt }); }}
                      title="Renombrar"
                      className="p-1.5 rounded-lg bg-white shadow border border-[#1a2d56]/10 text-[#1a2d56]/50 hover:text-[#1a2d56] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCategory(bt, true); }}
                      title="Eliminar"
                      className="p-1.5 rounded-lg bg-white shadow border border-red-100 text-red-400 hover:text-red-600 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Subcarpetas */}
      {selectedType && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-[#1a2d56]/50 uppercase tracking-wider">
              Subcarpetas — {selectedType.name}
            </h2>
            {isSuperAdmin && (
              <button
                onClick={() => setModal({ mode: "create-sub" })}
                className="flex items-center gap-1 text-xs font-medium text-[#1a2d56] hover:text-[#c8a84e] transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Nueva subcarpeta
              </button>
            )}
          </div>
          {subcategories.length === 0 ? (
            <p className="text-xs text-[#1a2d56]/40 italic">Sin subcarpetas. {isSuperAdmin && "Crea una con el botón anterior."}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {subcategories.map((sub) => {
                const isSelected = selectedSub?.id === sub.id;
                return (
                <div key={sub.id} className="relative group">
                  <button
                    onClick={() => handleSelectSub(sub)}
                    className={`w-full h-full flex items-center gap-3.5 p-4 rounded-2xl border-2 text-left transition-all ${
                      isSelected
                        ? "border-[#1a2d56] bg-[#1a2d56]/5 shadow-md"
                        : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/25 hover:shadow-md"
                    }`}
                  >
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                        isSelected ? "bg-[#1a2d56]/10" : "bg-[#1a2d56]/6"
                      }`}
                    >
                      <svg
                        className={`w-5 h-5 ${isSelected ? "text-[#1a2d56]" : "text-[#1a2d56]/35"}`}
                        fill="currentColor" viewBox="0 0 24 24"
                      >
                        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-normal text-[#1a2d56] leading-snug">{sub.name}</p>
                      <p className="text-[11px] text-[#1a2d56]/40 mt-0.5">
                        {sub.template_count} plantilla{sub.template_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </button>
                  {isSuperAdmin && (
                    <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setModal({ mode: "rename", target: sub }); }}
                        title="Renombrar"
                        className="p-1.5 rounded-lg bg-white shadow border border-[#1a2d56]/10 text-[#1a2d56]/50 hover:text-[#1a2d56] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCategory(sub, false); }}
                        title="Eliminar"
                        className="p-1.5 rounded-lg bg-white shadow border border-red-100 text-red-400 hover:text-red-600 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Templates list */}
      {selectedSub ? (
        loading ? (
          <div className="text-center py-8 text-[#1a2d56]/50">Cargando...</div>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-10 text-center">
            <p className="text-[#1a2d56]/60">No hay plantillas en esta subcarpeta.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-[#1a2d56]/8 overflow-hidden">
            <table className="w-full">
              <thead style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}>
                <tr>
                  <th className="py-3.5 px-5 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Plantilla</th>
                  <th className="py-3.5 px-5 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Campos</th>
                  <th className="py-3.5 px-5 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Fecha</th>
                  <th className="py-3.5 px-5 text-right text-[11px] font-semibold text-white/90 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-[#1a2d56]/5 hover:bg-[#1a2d56]/[0.02]">
                    <td className="py-3 px-5">
                      <div className="font-medium text-[#1a2d56] text-sm">{t.name}</div>
                      {t.description && <div className="text-xs text-[#1a2d56]/40 mt-0.5">{t.description}</div>}
                    </td>
                    <td className="py-3 px-5">
                      <span className="bg-[#1a2d56]/10 text-[#1a2d56] text-xs font-medium px-2 py-0.5 rounded-full">{t.field_count}</span>
                    </td>
                    <td className="py-3 px-5 text-xs text-[#1a2d56]/40">
                      {new Date(t.created_at).toLocaleDateString("es-CL")}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/templates/${t.id}`}
                          className="inline-flex items-center gap-1 bg-[#1a2d56]/5 text-[#1a2d56] py-1.5 px-3 rounded-lg text-xs font-medium hover:bg-[#1a2d56]/10 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {isSuperAdmin ? "Administrar" : "Ver"}
                        </Link>
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleDeleteTemplate(t.id, t.name)}
                            className="inline-flex items-center gap-1 bg-red-50 text-red-600 py-1.5 px-3 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : selectedType ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-10 text-center">
          <p className="text-[#1a2d56]/50 text-sm">Seleccione una subcarpeta para ver las plantillas.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-10 text-center">
          <p className="text-[#1a2d56]/50 text-sm">Seleccione un tipo de contrato para ver sus subcarpetas y plantillas.</p>
        </div>
      )}
    </div>
  );
}
