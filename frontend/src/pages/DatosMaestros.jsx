import { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import {
  uploadDireccionesExcel,
  getDireccionesCount,
  uploadPresupuestoExcel,
  getPresupuestoCount,
  getHistorialUploads,
} from "../services/api";

const SOURCE_LABELS = {
  direcciones: "Direcciones de Inmuebles",
  presupuesto: "Presupuesto (Subtítulo/Ítem/Asignación)",
};

function formatFecha(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function UploadCard({ title, description, count, accept, onUpload }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const result = await onUpload(file);
      toast(result.message || "Importado correctamente.", "success");
      setFile(null);
    } catch (err) {
      toast("Error al importar: " + err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
      <h2 className="text-lg font-semibold text-[#112d86] mb-1">{title}</h2>
      <p className="text-xs text-[#112d86]/50 mb-4">{description}</p>

      <div className="bg-[#112d86]/5 rounded-lg px-4 py-3 mb-4">
        <p className="text-xs text-[#112d86]/50 uppercase tracking-wide font-semibold">Registros cargados</p>
        <p className="text-2xl font-bold text-[#112d86]">{count === null ? "—" : count}</p>
      </div>

      <label className="block text-sm font-medium text-[#112d86] mb-2">Actualizar desde Excel</label>
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept={accept}
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="flex-1 text-sm border border-[#112d86]/20 rounded-lg px-3 py-2"
        />
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-all"
          style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
        >
          {uploading ? "Cargando..." : "Cargar Excel"}
        </button>
      </div>
      <p className="text-[11px] text-[#c8a84e] mt-2 font-medium">
        Al cargar un nuevo archivo, se reemplaza por completo el listado anterior.
      </p>
    </div>
  );
}

export default function DatosMaestros() {
  const [direccionesCount, setDireccionesCount] = useState(null);
  const [presupuestoCount, setPresupuestoCount] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [d, p] = await Promise.all([getDireccionesCount(), getPresupuestoCount()]);
      setDireccionesCount(d.total);
      setPresupuestoCount(p.total);
    } catch {
      // silencioso; los contadores individuales quedan en "—"
    }
    try {
      const h = await getHistorialUploads();
      setHistorial(h);
    } catch {
      setHistorial([]);
    } finally {
      setLoadingHistorial(false);
    }
  }

  async function handleUploadDirecciones(file) {
    const result = await uploadDireccionesExcel(file);
    await loadAll();
    return result;
  }

  async function handleUploadPresupuesto(file) {
    const result = await uploadPresupuestoExcel(file);
    await loadAll();
    return result;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#112d86]">Datos Maestros</h1>
        <p className="text-sm text-[#112d86]/60 mt-1">
          Gestione los datos de referencia utilizados en los campos automáticos de las plantillas
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UploadCard
          title="Direcciones de Inmuebles"
          description={'Fuente para el campo automático de dirección. Solo se consideran inmuebles con estado "EN USO".'}
          count={direccionesCount}
          accept=".xlsx,.xlsm"
          onUpload={handleUploadDirecciones}
        />
        <UploadCard
          title="Presupuesto (Subtítulo / Ítem / Asignación)"
          description="Fuente para los campos automáticos de clasificación presupuestaria según Ley de Presupuesto."
          count={presupuestoCount}
          accept=".xlsx,.xlsm"
          onUpload={handleUploadPresupuesto}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#112d86]/8" style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}>
          <h2 className="text-sm font-semibold text-white">Historial de Cargas</h2>
        </div>
        {loadingHistorial ? (
          <p className="text-sm text-[#112d86]/40 px-5 py-6">Cargando...</p>
        ) : historial.length === 0 ? (
          <p className="text-sm text-[#112d86]/40 px-5 py-6">Aún no se ha cargado ningún archivo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[#112d86]/40 uppercase tracking-wide border-b border-[#112d86]/8">
                <th className="px-5 py-2.5 font-semibold">Fuente</th>
                <th className="px-5 py-2.5 font-semibold">Archivo</th>
                <th className="px-5 py-2.5 font-semibold">Registros</th>
                <th className="px-5 py-2.5 font-semibold">Cargado por</th>
                <th className="px-5 py-2.5 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#112d86]/5">
              {historial.map((h) => (
                <tr key={h.id}>
                  <td className="px-5 py-2.5 font-medium text-[#112d86]">{SOURCE_LABELS[h.source] || h.source}</td>
                  <td className="px-5 py-2.5 text-[#112d86]/70">{h.filename}</td>
                  <td className="px-5 py-2.5 text-[#112d86]/70">{h.record_count}</td>
                  <td className="px-5 py-2.5 text-[#112d86]/70">{h.uploaded_by || "—"}</td>
                  <td className="px-5 py-2.5 text-[#112d86]/50">{formatFecha(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
