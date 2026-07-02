import { useState } from "react";
import { createTemplate } from "../services/api";

export default function UploadTemplate({ biddingTypes = [], selectedTypeId = null, selectedSubId = null, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState(selectedTypeId ? String(selectedTypeId) : "");
  const [subId, setSubId] = useState(selectedSubId ? String(selectedSubId) : "");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedType = biddingTypes.find((bt) => String(bt.id) === typeId);
  const subcategories = selectedType?.children || [];

  function handleTypeChange(val) {
    setTypeId(val);
    setSubId("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) {
      setError("Seleccione un archivo .docx");
      return;
    }
    if (!subId) {
      setError("Seleccione tipo de contrato y subcarpeta");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await createTemplate(name, description, file, subId);
      setName("");
      setDescription("");
      if (!selectedTypeId) setTypeId("");
      if (!selectedSubId) setSubId("");
      setFile(null);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-[#1a2d56]">Cargar Nueva Plantilla</h2>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1a2d56] mb-1">Nombre</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
            placeholder="Ej: Contrato de Servicios"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1a2d56] mb-1">Tipo de Contrato</label>
          <select
            value={typeId}
            onChange={(e) => handleTypeChange(e.target.value)}
            disabled={!!selectedTypeId}
            className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30 disabled:bg-[#1a2d56]/5"
          >
            <option value="">— Seleccione tipo —</option>
            {biddingTypes.map((bt) => (
              <option key={bt.id} value={bt.id}>{bt.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1a2d56] mb-1">Subcarpeta</label>
          <select
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            disabled={!typeId || !!selectedSubId}
            className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30 disabled:bg-[#1a2d56]/5"
          >
            <option value="">— Seleccione subcarpeta —</option>
            {subcategories.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1a2d56] mb-1">Descripción</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
            placeholder="Descripción opcional"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#1a2d56] mb-1">Archivo Word (.docx)</label>
        <input
          type="file"
          accept=".docx"
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="w-full text-sm text-[#1a2d56]/60 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#1a2d56]/5 file:text-[#1a2d56] hover:file:bg-[#1a2d56]/10"
        />
        <p className="mt-1 text-xs text-[#1a2d56]/40">
          Use marcadores {"{{campo}}"} en la plantilla Word para definir campos dinámicos.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#1a2d56] text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-[#243b6e] disabled:opacity-50 transition-colors"
      >
        {loading ? "Subiendo..." : "Cargar Plantilla"}
      </button>
    </form>
  );
}
