import { useState, useRef } from "react";
import { uploadInsumo, deleteInsumo } from "../services/api";

function prettyLabel(key) {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function InsumoUpload({ insumos, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function handleFiles(fileList) {
    setError("");
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const result = await uploadInsumo(file);
        // Todo lo detectado queda aprobado (con tic) por defecto; el usuario
        // puede destildar lo que no quiera traspasar al formulario.
        const approved = {};
        for (const [k, v] of Object.entries(result.extracted || {})) {
          if (v) approved[k] = true;
        }
        onChange([...insumos, { ...result, approved }]);
      }
    } catch (err) {
      setError(err.message || "Error al cargar el documento");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(id) {
    try {
      await deleteInsumo(id);
      onChange(insumos.filter((i) => i.id !== id));
    } catch (err) {
      setError(err.message || "No se pudo eliminar el documento");
    }
  }

  function handleToggle(id, key) {
    onChange(
      insumos.map((i) =>
        i.id === id ? { ...i, approved: { ...i.approved, [key]: !i.approved?.[key] } } : i
      )
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
      <h2 className="text-sm font-semibold text-[#112d86] mb-1">Documentos de insumo</h2>
      <p className="text-xs text-[#112d86]/50 mb-4">
        Cargue los documentos de respaldo del contrato (cotizaciones, pólizas, contratos previos, etc.).
        El sistema intentará detectar datos relevantes del contrato. Revise y confirme con el tic cuáles
        datos detectados desea traspasar al formulario.
      </p>

      <label
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-6 cursor-pointer transition-colors ${
          uploading ? "border-[#112d86]/20 bg-[#112d86]/[0.02]" : "border-[#112d86]/25 hover:border-[#112d86]/40 hover:bg-[#112d86]/[0.02]"
        }`}
      >
        <svg className="w-6 h-6 text-[#112d86]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span className="text-xs font-medium text-[#112d86]/60">
          {uploading ? "Cargando y analizando..." : "Arrastre archivos o haga clic para cargar (PDF o Word)"}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc"
          multiple
          disabled={uploading}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      {insumos.length > 0 && (
        <ul className="mt-4 space-y-2">
          {insumos.map((i) => {
            const found = Object.entries(i.extracted || {}).filter(([, v]) => v);
            return (
              <li key={i.id} className="border border-[#112d86]/10 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 text-[#112d86]/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-1.519-2.394a3.375 3.375 0 00-2.965-1.756M15 17.25h-1.5m1.5 0V21m-1.5-3.75L12 21" />
                    </svg>
                    <span className="text-sm text-[#112d86] truncate">{i.filename}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(i.id)}
                    title="Eliminar"
                    className="text-red-400 hover:text-red-600 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                {found.length > 0 ? (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[10px] font-medium text-[#112d86]/40 uppercase tracking-wider">
                      Datos detectados — desmarque lo que no desea traspasar
                    </p>
                    {found.map(([k, v]) => {
                      const checked = i.approved?.[k] !== false;
                      return (
                        <label key={k} className="flex items-start gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggle(i.id, k)}
                            className="mt-0.5 accent-[#112d86] flex-shrink-0"
                          />
                          <span className={`text-xs leading-snug ${checked ? "text-[#112d86]" : "text-[#112d86]/35 line-through"}`}>
                            <span className="font-medium">{prettyLabel(k)}:</span>{" "}
                            {v.length > 120 ? v.slice(0, 120) + "…" : v}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[10px] text-[#112d86]/40 mt-1.5">No se detectaron datos automáticamente en este documento.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
