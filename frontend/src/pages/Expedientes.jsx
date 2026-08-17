import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCategories, getBundles, createBundle, deleteBundle } from "../services/api";
import JurisdiccionSelector from "../components/JurisdiccionSelector";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";

export default function Expedientes() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [bundles, setBundles] = useState([]);
  const [biddingTypes, setBiddingTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTypeId, setNewTypeId] = useState("");
  const [newNombre, setNewNombre] = useState("");
  const [newJurisdiccion, setNewJurisdiccion] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([getBundles(), getCategories(true)]);
      setBundles(b);
      setBiddingTypes(c);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newTypeId) {
      setError("Seleccione un tipo de contrato");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const bundle = await createBundle({
        category_id: Number(newTypeId),
        nombre_licitacion: newNombre.trim(),
        jurisdiccion: newJurisdiccion,
      });
      setShowNew(false);
      setNewTypeId("");
      setNewNombre("");
      setNewJurisdiccion("");
      navigate(`/expediente/${bundle.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(bundle) {
    if (!await confirm(`¿Eliminar el Expediente N° ${bundle.correlativo} (${bundle.category_name})?`, { confirmLabel: "Eliminar", danger: true, title: "Eliminar expediente" })) return;
    try {
      await deleteBundle(bundle.id);
      toast("Expediente eliminado.", "success");
      load();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#112d86]">Generar Contratos</h1>
          <p className="text-sm text-[#112d86]/60 mt-1">
            Gestione sus expedientes de antecedentes de contrato
          </p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="inline-flex items-center gap-2 text-white py-2 px-4 rounded-xl text-sm font-semibold shadow-sm hover:shadow-md transition-all"
          style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nuevo Expediente
        </button>
      </div>

      {/* New Bundle form */}
      {showNew && (
        <div className="bg-white rounded-xl shadow-sm border-2 border-[#c8a84e]/40 p-6">
          <h2 className="text-base font-semibold text-[#112d86] mb-4">Crear Nuevo Expediente</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#112d86] mb-1">
                  Tipo de Contrato <span className="text-red-500">*</span>
                </label>
                <select
                  value={newTypeId}
                  onChange={(e) => setNewTypeId(e.target.value)}
                  className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#112d86]/30"
                >
                  <option value="">— Seleccione tipo de contrato —</option>
                  {biddingTypes.map((bt) => (
                    <option key={bt.id} value={bt.id}>{bt.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#112d86] mb-1">
                  Nombre del Contrato <span className="text-[#112d86]/40 font-normal text-xs">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={newNombre}
                  onChange={(e) => setNewNombre(e.target.value)}
                  placeholder="Ej: Servicio de Aseo Edificio Tribunales"
                  className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#112d86]/30"
                />
              </div>
              <div className="md:col-span-2">
                <JurisdiccionSelector value={newJurisdiccion} onChange={setNewJurisdiccion} />
              </div>
            </div>
            <div className="bg-[#112d86]/5 rounded-lg p-3">
              <p className="text-xs text-[#112d86]/60">
                Se creará una lista de comprobación con el contrato principal y, opcionalmente,
                los anexos correspondientes.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setShowNew(false); setError(""); }}
                className="px-4 py-2 text-sm text-[#112d86]/60 hover:text-[#112d86] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all"
                style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
              >
                {creating ? "Creando..." : "Crear Expediente"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      {!loading && bundles.length > 0 && (
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#112d86]/30"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, tipo o jurisdicción..."
            className="w-full pl-10 pr-4 py-2.5 border border-[#112d86]/15 rounded-xl text-sm focus:ring-2 focus:ring-[#112d86]/20 focus:border-[#112d86]/30 bg-white"
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#112d86]/30 hover:text-[#112d86]/60 text-sm">
              Limpiar
            </button>
          )}
        </div>
      )}

      {/* Bundle list */}
      {loading ? (
        <div className="text-center py-10 text-[#112d86]/50">Cargando expedientes...</div>
      ) : bundles.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-12 text-center">
          <svg className="w-14 h-14 mx-auto text-[#112d86]/15 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-[#112d86]/50 text-sm">
            No ha creado expedientes aún. Haga clic en <strong>Nuevo Expediente</strong> para comenzar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bundles
            .filter((b) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                String(b.correlativo).includes(q) ||
                (b.category_name || "").toLowerCase().includes(q) ||
                (b.nombre_licitacion || "").toLowerCase().includes(q) ||
                (b.jurisdiccion || "").toLowerCase().includes(q)
              );
            })
            .map((b) => {
            const pct = b.total_items > 0 ? Math.round((b.completed_items / b.total_items) * 100) : 0;
            const allDone = b.completed_items === b.total_items && b.total_items > 0;
            return (
              <div
                key={b.id}
                className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div
                  className="px-5 py-4 cursor-pointer"
                  onClick={() => navigate(`/expediente/${b.id}`)}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[#c8a84e] font-bold text-sm">Expediente N° {b.correlativo}</span>
                        {allDone && (
                          <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                            Completo
                          </span>
                        )}
                      </div>
                      <p className="text-[#112d86] font-semibold text-sm mt-0.5 truncate">{b.category_name}</p>
                      {b.nombre_licitacion && (
                        <p className="text-xs text-[#112d86]/50 mt-0.5 truncate">{b.nombre_licitacion}</p>
                      )}
                      {b.jurisdiccion && (
                        <p className="text-xs text-[#112d86]/40 mt-0.5">{b.jurisdiccion}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-lg font-bold text-[#112d86]">{b.completed_items}</span>
                      <span className="text-sm text-[#112d86]/40">/{b.total_items}</span>
                    </div>
                  </div>

                  <div className="h-1.5 bg-[#112d86]/8 rounded-full overflow-hidden">
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
                  <p className="text-[10px] text-[#112d86]/40 mt-1.5">
                    {b.completed_items} de {b.total_items} documentos completados
                  </p>
                  <p className="text-[10px] text-[#112d86]/30 mt-1">
                    Creado: {new Date(b.created_at).toLocaleDateString("es-CL", {
                      day: "2-digit", month: "2-digit", year: "numeric"
                    })}
                  </p>
                </div>

                <div className="px-5 py-3 border-t border-[#112d86]/5 flex items-center justify-between">
                  <button
                    onClick={() => navigate(`/expediente/${b.id}`)}
                    className="text-xs font-semibold text-[#112d86] hover:text-[#1a3a9e] flex items-center gap-1 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Abrir expediente
                  </button>
                  <button
                    onClick={() => handleDelete(b)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    title="Eliminar expediente"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
