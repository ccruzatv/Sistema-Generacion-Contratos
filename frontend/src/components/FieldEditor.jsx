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
  { value: "percentage", label: "Porcentaje" },
];

// field_type "percentage" admite un grupo opcional codificado como
// "percentage:nombre_grupo" — los campos porcentaje que comparten grupo
// deben sumar 100% entre sí (ver DynamicForm.jsx). Sin grupo, es un
// porcentaje suelto sin esa validación — útil cuando una misma plantilla
// tiene varios porcentajes independientes (ej. criterios de evaluación
// que suman 100%, más un porcentaje de garantía aparte).
function splitPercentageType(fieldType) {
  if (!fieldType?.startsWith("percentage")) return { base: fieldType, group: "" };
  const [, group = ""] = fieldType.split(":");
  return { base: "percentage", group };
}

function composeFieldType(base, group) {
  if (base !== "percentage") return base;
  const g = group.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return g ? `percentage:${g}` : "percentage";
}

function FieldRow({ field, templateId, onUpdated, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(field.field_label);
  const initial = splitPercentageType(field.field_type);
  const [type, setType] = useState(initial.base);
  const [pctGroup, setPctGroup] = useState(initial.group);
  const [required, setRequired] = useState(field.required);
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setLoading(true);
    try {
      await updateField(templateId, field.id, { field_label: label, field_type: composeFieldType(type, pctGroup), required });
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
        <td className="py-3 px-4 text-sm text-[#112d86]/70">
          {initial.base === "percentage" ? (
            <>Porcentaje{initial.group && <span className="text-[#112d86]/40"> ({initial.group})</span>}</>
          ) : field.field_type}
        </td>
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
        {type === "percentage" && (
          <input
            type="text"
            value={pctGroup}
            onChange={(e) => setPctGroup(e.target.value)}
            placeholder="Grupo (opcional, ej: evaluacion)"
            title="Campos porcentaje con el mismo grupo deben sumar 100% entre sí. Vacío = porcentaje suelto, sin esa validación."
            className="mt-1 border border-[#112d86]/20 rounded-lg px-2 py-1 text-xs w-full"
          />
        )}
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
  const [newPctGroup, setNewPctGroup] = useState("");

  async function handleAdd() {
    if (!newKey.trim()) return;
    await addField(templateId, {
      field_key: newKey.trim(),
      field_label: newLabel.trim() || newKey.trim(),
      field_type: composeFieldType(newType, newPctGroup),
      field_order: fields.length,
      required: true,
    });
    setNewKey("");
    setNewLabel("");
    setNewType("text");
    setNewPctGroup("");
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
          {newType === "percentage" && (
            <div>
              <label className="block text-xs font-medium text-[#112d86] mb-1">Grupo (opcional)</label>
              <input
                type="text"
                value={newPctGroup}
                onChange={(e) => setNewPctGroup(e.target.value)}
                placeholder="ej: evaluacion"
                title="Campos porcentaje con el mismo grupo deben sumar 100% entre sí."
                className="border border-[#112d86]/20 rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
          )}
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
