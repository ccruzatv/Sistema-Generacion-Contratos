import { useState } from "react";
import { updateField, deleteField, addField } from "../services/api";

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "textarea", label: "Texto largo" },
  { value: "number", label: "Número" },
  { value: "date", label: "Fecha" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Teléfono" },
  { value: "select", label: "Selección" },
];

function FieldRow({ field, templateId, onUpdated, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.field_label);
  const [type, setType] = useState(field.field_type);
  const [required, setRequired] = useState(field.required);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);
    try {
      await updateField(templateId, field.id, { field_label: label, field_type: type, required });
      setEditing(false);
      onUpdated?.();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Eliminar este campo?")) return;
    await deleteField(templateId, field.id);
    onUpdated?.();
  }

  if (!editing) {
    return (
      <tr className="border-b border-[#112d86]/5 hover:bg-[#112d86]/[0.02]">
        <td className="py-3 px-4 text-sm font-mono text-[#112d86]/60">{`{{${field.field_key}}}`}</td>
        <td className="py-3 px-4 text-sm text-[#112d86]">{field.field_label}</td>
        <td className="py-3 px-4 text-sm text-[#112d86]/70">{field.field_type}</td>
        <td className="py-3 px-4 text-sm text-[#112d86]/70">{field.required ? "Sí" : "No"}</td>
        {!readOnly && (
          <td className="py-3 px-4 text-sm space-x-2">
            <button onClick={() => setEditing(true)} className="text-[#112d86] hover:text-[#1a3a9e] text-sm font-medium">Editar</button>
            <button onClick={handleDelete} className="text-red-500 hover:text-red-700 text-sm">Eliminar</button>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr className="border-b border-[#112d86]/10 bg-[#112d86]/[0.03]">
      <td className="py-3 px-4 text-sm font-mono text-[#112d86]/60">{`{{${field.field_key}}}`}</td>
      <td className="py-3 px-4">
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="border border-[#112d86]/20 rounded-lg px-2 py-1 text-sm w-full" />
      </td>
      <td className="py-3 px-4">
        <select value={type} onChange={(e) => setType(e.target.value)} className="border border-[#112d86]/20 rounded-lg px-2 py-1 text-sm">
          {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </td>
      <td className="py-3 px-4">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[#112d86]" />
      </td>
      <td className="py-3 px-4 space-x-2">
        <button onClick={handleSave} disabled={loading} className="text-green-600 hover:text-green-800 text-sm font-medium">Guardar</button>
        <button onClick={() => setEditing(false)} className="text-[#112d86]/50 hover:text-[#112d86] text-sm">Cancelar</button>
      </td>
    </tr>
  );
}

export default function FieldEditor({ fields, templateId, onUpdated, readOnly = false }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("text");

  async function handleAdd() {
    if (!newKey.trim()) return;
    await addField(templateId, {
      field_key: newKey.trim(),
      field_label: newLabel.trim() || newKey.trim(),
      field_type: newType,
      field_order: fields.length,
      required: true,
    });
    setNewKey("");
    setNewLabel("");
    setNewType("text");
    setShowAdd(false);
    onUpdated?.();
  }

  const sorted = [...fields].sort((a, b) => a.field_order - b.field_order);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 overflow-hidden">
      <div className="px-6 py-4 border-b border-[#112d86]/10 flex justify-between items-center">
        <h3 className="text-lg font-semibold text-[#112d86]">Campos ({fields.length})</h3>
        {!readOnly && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="bg-[#112d86] text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#1a3a9e]"
          >
            + Agregar Campo
          </button>
        )}
      </div>

      {!readOnly && showAdd && (
        <div className="px-6 py-4 bg-[#112d86]/[0.03] border-b border-[#112d86]/10 flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs font-medium text-[#112d86] mb-1">Clave</label>
            <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="nombre_campo" className="border border-[#112d86]/20 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#112d86] mb-1">Etiqueta</label>
            <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Nombre del Campo" className="border border-[#112d86]/20 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#112d86] mb-1">Tipo</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} className="border border-[#112d86]/20 rounded-lg px-2 py-1.5 text-sm">
              {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <button onClick={handleAdd} className="bg-[#112d86] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-[#1a3a9e]">Agregar</button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="px-6 py-8 text-center text-[#112d86]/40 text-sm">
          No se detectaron campos en la plantilla.
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-[#112d86]/[0.03]">
            <tr>
              <th className="py-3 px-4 text-left text-xs font-semibold text-[#112d86]/60 uppercase tracking-wider">Marcador</th>
              <th className="py-3 px-4 text-left text-xs font-semibold text-[#112d86]/60 uppercase tracking-wider">Etiqueta</th>
              <th className="py-3 px-4 text-left text-xs font-semibold text-[#112d86]/60 uppercase tracking-wider">Tipo</th>
              <th className="py-3 px-4 text-left text-xs font-semibold text-[#112d86]/60 uppercase tracking-wider">Requerido</th>
              {!readOnly && <th className="py-3 px-4 text-left text-xs font-semibold text-[#112d86]/60 uppercase tracking-wider">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((field) => (
              <FieldRow key={field.id} field={field} templateId={templateId} onUpdated={onUpdated} readOnly={readOnly} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
