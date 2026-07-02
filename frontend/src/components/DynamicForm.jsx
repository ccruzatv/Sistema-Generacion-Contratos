import { useState, useEffect } from "react";
import { getTribunalesDisponibles } from "../services/api";

export default function DynamicForm({ fields, onSubmit, loading, initialValues, onSaveDraft, savingDraft }) {
  const seen = new Set();
  const sorted = [...fields]
    .sort((a, b) => a.field_order - b.field_order)
    .filter((f) => seen.has(f.field_key) ? false : seen.add(f.field_key));
  const [values, setValues] = useState(() => {
    const initial = {};
    sorted.forEach((f) => (initial[f.field_key] = initialValues?.[f.field_key] || ""));
    return initial;
  });
  const [tribunalesDisponibles, setTribunalesDisponibles] = useState([]);

  const hasTablaTribunales = sorted.some((f) => f.field_type === "tabla_tribunales");

  useEffect(() => {
    if (hasTablaTribunales) {
      getTribunalesDisponibles().then(setTribunalesDisponibles).catch(() => {});
    }
  }, [hasTablaTribunales]);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(values);
  }

  function handleDraft() {
    if (onSaveDraft) onSaveDraft(values);
  }

  function renderField(field) {
    const isEmpty = !String(values[field.field_key] || "").trim();
    const isMissing = field.required && isEmpty;
    const borderClasses = isMissing
      ? "border-red-400 bg-red-50 focus:ring-red-300 focus:border-red-400"
      : "border-[#1a2d56]/20 focus:ring-[#1a2d56]/30 focus:border-[#1a2d56]/40";
    const isNumber = (field.field_type || "text") === "number";
    const common = {
      id: field.field_key,
      value: values[field.field_key] || "",
      onChange: (e) => handleChange(field.field_key, e.target.value),
      required: field.required,
      placeholder: field.placeholder || `Ingrese ${field.field_label.toLowerCase()}`,
      className: `w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 ${borderClasses}`,
    };

    if (field.field_type === "tabla_tribunales") {
      const selected = values[field.field_key] || "";
      const isMissingTabla = field.required && !selected;
      return (
        <div className="space-y-3">
          <select
            id={field.field_key}
            value={selected}
            onChange={(e) => handleChange(field.field_key, e.target.value)}
            required={field.required}
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white ${
              isMissingTabla
                ? "border-red-400 bg-red-50 focus:ring-red-300 focus:border-red-400"
                : "border-[#1a2d56]/20 focus:ring-[#1a2d56]/30 focus:border-[#1a2d56]/40"
            }`}
          >
            <option value="">— Seleccione jurisdicción —</option>
            {tribunalesDisponibles.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
          {tribunalesDisponibles.length === 0 && (
            <p className="text-xs text-[#c8a84e] italic">
              No hay jurisdicciones disponibles. Verifique la conexión con el Excel de OneDrive.
            </p>
          )}
        </div>
      );
    }

    if (field.field_type === "textarea") {
      return <textarea {...common} rows={3} />;
    }

    if (field.field_type === "select" && field.options) {
      const opts = field.options.split(",").map((o) => o.trim());
      return (
        <select {...common}>
          <option value="">-- Seleccione --</option>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    if (isNumber) {
      return <input type="number" min="1" step="any" {...common} />;
    }

    return <input type={field.field_type || "text"} {...common} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {sorted.map((field) => (
        <div key={field.field_key}>
          <label
            htmlFor={field.field_key}
            className="block text-sm font-medium text-[#1a2d56] mb-1"
          >
            {field.field_label}
            {field.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {renderField(field)}
        </div>
      ))}

      <div className={`flex gap-3 ${onSaveDraft ? "flex-row" : ""}`}>
        {onSaveDraft && (
          <button
            type="button"
            onClick={handleDraft}
            disabled={savingDraft || loading}
            className="flex-1 flex items-center justify-center gap-2 border-2 border-[#1a2d56]/20 text-[#1a2d56] py-3 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a2d56]/5 transition-all duration-200"
          >
            {savingDraft ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Guardando...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" /></svg>
                Guardar Borrador
              </>
            )}
          </button>
        )}
        <button
          type="submit"
          disabled={loading || savingDraft}
          className={`${onSaveDraft ? "flex-1" : "w-full"} flex items-center justify-center gap-2 text-white py-3 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]`}
          style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
        >
          {loading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Generando documento...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
              Generar Documento
            </>
          )}
        </button>
      </div>
    </form>
  );
}
