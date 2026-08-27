import { useState, useEffect } from "react";
import { getTribunalesDisponibles, getDireccionesJurisdicciones, buscarDirecciones, getSubtitulos, getItemsPresupuesto, getAsignacionesPresupuesto } from "../services/api";

export default function DynamicForm({ fields, onSubmit, loading, initialValues, onSaveDraft, savingDraft, jurisdiccion, autoFillValues }) {
  const seen = new Set();
  const sorted = [...fields]
    .sort((a, b) => a.field_order - b.field_order)
    .filter((f) => seen.has(f.field_key) ? false : seen.add(f.field_key));
  const [values, setValues] = useState(() => {
    const initial = {};
    sorted.forEach((f) => (initial[f.field_key] = initialValues?.[f.field_key] || ""));
    return initial;
  });
  const [autoFilledKeys, setAutoFilledKeys] = useState(new Set());
  const [tribunalesDisponibles, setTribunalesDisponibles] = useState([]);

  // Datos detectados en documentos de insumo: solo completan campos aún vacíos,
  // nunca pisan lo que el usuario ya escribió.
  useEffect(() => {
    if (!autoFillValues || Object.keys(autoFillValues).length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      const filled = new Set();
      for (const [key, val] of Object.entries(autoFillValues)) {
        if (val && !prev[key]) {
          next[key] = val;
          filled.add(key);
        }
      }
      if (filled.size > 0) setAutoFilledKeys((old) => new Set([...old, ...filled]));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillValues]);

  const hasTablaTribunales = sorted.some((f) => f.field_type === "tabla_tribunales");
  const hasDireccionInmueble = sorted.some((f) => f.field_type === "direccion_inmueble");
  const subtituloField = sorted.find((f) => f.field_type === "presupuesto_subtitulo");
  const itemField = sorted.find((f) => f.field_type === "presupuesto_item");
  const asignacionField = sorted.find((f) => f.field_type === "presupuesto_asignacion");
  const hasPresupuesto = !!subtituloField;
  const [subtitulos, setSubtitulos] = useState([]);
  const [itemsPresupuesto, setItemsPresupuesto] = useState([]);
  const [asignacionesPresupuesto, setAsignacionesPresupuesto] = useState([]);

  useEffect(() => {
    if (hasPresupuesto) {
      getSubtitulos().then(setSubtitulos).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPresupuesto]);

  useEffect(() => {
    const sub = subtituloField ? values[subtituloField.field_key] : "";
    if (sub) {
      getItemsPresupuesto(sub).then(setItemsPresupuesto).catch(() => setItemsPresupuesto([]));
    } else {
      setItemsPresupuesto([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtituloField && values[subtituloField.field_key]]);

  useEffect(() => {
    const sub = subtituloField ? values[subtituloField.field_key] : "";
    const it = itemField ? values[itemField.field_key] : "";
    if (sub && it) {
      getAsignacionesPresupuesto(sub, it).then(setAsignacionesPresupuesto).catch(() => setAsignacionesPresupuesto([]));
    } else {
      setAsignacionesPresupuesto([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtituloField && values[subtituloField.field_key], itemField && values[itemField.field_key]]);

  function handleSubtituloChange(v) {
    handleChange(subtituloField.field_key, v);
    if (itemField) handleChange(itemField.field_key, "");
    if (asignacionField) handleChange(asignacionField.field_key, "");
  }

  function handleItemChange(v) {
    handleChange(itemField.field_key, v);
    if (asignacionField) handleChange(asignacionField.field_key, "");
  }
  const [jurisdiccionesDireccion, setJurisdiccionesDireccion] = useState([]);
  const [direccionUI, setDireccionUI] = useState({});

  useEffect(() => {
    if (hasDireccionInmueble) {
      getDireccionesJurisdicciones().then((lista) => {
        setJurisdiccionesDireccion(lista);
        if (jurisdiccion) {
          const match = lista.find((j) => j.trim().toLowerCase() === jurisdiccion.trim().toLowerCase());
          if (match) {
            sorted
              .filter((f) => f.field_type === "direccion_inmueble")
              .forEach((f) => setDireccionField(f.field_key, { jurisdiccion: match }));
          }
        }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDireccionInmueble, jurisdiccion]);

  function setDireccionField(key, patch) {
    setDireccionUI((prev) => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  }

  async function handleDireccionSearch(key, jurisdiccion, q) {
    setDireccionField(key, { query: q, open: true });
    if (!jurisdiccion) return;
    try {
      const results = await buscarDirecciones(jurisdiccion, q);
      setDireccionField(key, { results });
    } catch {
      setDireccionField(key, { results: [] });
    }
  }
  // Campos "percentage" o "percentage:grupo" — los que comparten grupo deben
  // sumar 100% entre sí; una plantilla puede tener varios grupos
  // independientes (ej. criterios de evaluación que suman 100%, más un
  // porcentaje de garantía suelto que no forma parte de esa suma).
  const percentageFields = sorted.filter((f) => f.field_type === "percentage" || f.field_type?.startsWith("percentage:"));
  const percentageGroupsMap = {};
  for (const f of percentageFields) {
    const group = f.field_type.includes(":") ? f.field_type.split(":")[1] : "";
    (percentageGroupsMap[group] ||= []).push(f);
  }
  const percentageGroups = Object.entries(percentageGroupsMap)
    .filter(([, fields]) => fields.length >= 2)
    .map(([group, fields]) => {
      const sum = fields.reduce((acc, f) => acc + (parseFloat(values[f.field_key]) || 0), 0);
      return { group, sum, mismatch: Math.abs(sum - 100) > 0.001 };
    });
  const percentageMismatch = percentageGroups.some((g) => g.mismatch);

  useEffect(() => {
    if (hasTablaTribunales) {
      getTribunalesDisponibles().then(setTribunalesDisponibles).catch(() => {});
    }
  }, [hasTablaTribunales]);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (autoFilledKeys.has(key)) {
      setAutoFilledKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (percentageMismatch) return;
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
      : "border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40";
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
                : "border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40"
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

    if (field.field_type === "direccion_inmueble") {
      const ui = direccionUI[field.field_key] || {};
      const isMissingDir = field.required && !values[field.field_key];
      return (
        <div className="space-y-2">
          <select
            value={ui.jurisdiccion || ""}
            onChange={(e) => {
              setDireccionField(field.field_key, { jurisdiccion: e.target.value, query: "", results: [] });
              handleChange(field.field_key, "");
            }}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40"
          >
            <option value="">— Seleccione jurisdicción —</option>
            {jurisdiccionesDireccion.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#112d86]/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              disabled={!ui.jurisdiccion}
              value={values[field.field_key] ? `${values[field.field_key]}` : (ui.query || "")}
              onChange={(e) => {
                handleChange(field.field_key, "");
                handleDireccionSearch(field.field_key, ui.jurisdiccion, e.target.value);
              }}
              onFocus={() => setDireccionField(field.field_key, { open: true })}
              placeholder={ui.jurisdiccion ? "Busque por edificio o dirección..." : "Seleccione una jurisdicción primero"}
              className={`w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:ring-2 disabled:bg-[#112d86]/5 disabled:cursor-not-allowed ${
                isMissingDir
                  ? "border-red-400 bg-red-50 focus:ring-red-300 focus:border-red-400"
                  : "border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40"
              }`}
            />
            {ui.open && ui.jurisdiccion && (ui.results || []).length > 0 && !values[field.field_key] && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-[#112d86]/15 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {ui.results.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => {
                      handleChange(field.field_key, r.direccion_seal);
                      setDireccionField(field.field_key, { open: false, query: "" });
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-[#112d86]/5 border-b border-[#112d86]/5 last:border-0"
                  >
                    <p className="font-medium text-[#112d86]">{r.nombre_edificio}</p>
                    <p className="text-[#112d86]/50">{r.direccion_seal}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
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

    if (field.field_type === "percentage" || field.field_type?.startsWith("percentage:")) {
      return (
        <div className="relative">
          <input type="number" min="0" max="100" step="any" {...common} className={`${common.className} pr-8`} />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#112d86]/40">%</span>
        </div>
      );
    }

    if (isNumber) {
      return <input type="number" min="1" step="any" {...common} />;
    }

    return <input type={field.field_type || "text"} {...common} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {sorted.map((field) => {
        if (itemField && field.field_key === itemField.field_key) return null;
        if (asignacionField && field.field_key === asignacionField.field_key) return null;

        if (subtituloField && field.field_key === subtituloField.field_key) {
          return (
            <div key={field.field_key} className="space-y-3 border border-[#112d86]/10 rounded-lg p-3 bg-[#112d86]/[0.02]">
              <p className="text-xs font-semibold text-[#112d86]/50 uppercase tracking-wide">
                Clasificación Presupuestaria
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </p>
              <div>
                <label className="block text-sm font-medium text-[#112d86] mb-1">Subtítulo</label>
                <select
                  value={values[subtituloField.field_key] || ""}
                  onChange={(e) => handleSubtituloChange(e.target.value)}
                  required={subtituloField.required}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40"
                >
                  <option value="">— Seleccione subtítulo —</option>
                  {subtitulos.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {itemField && (
                <div>
                  <label className="block text-sm font-medium text-[#112d86] mb-1">Ítem</label>
                  <select
                    value={values[itemField.field_key] || ""}
                    onChange={(e) => handleItemChange(e.target.value)}
                    required={itemField.required}
                    disabled={!values[subtituloField.field_key]}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40 disabled:bg-[#112d86]/5 disabled:cursor-not-allowed"
                  >
                    <option value="">— Seleccione ítem —</option>
                    {itemsPresupuesto.map((i) => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
              )}
              {asignacionField && (
                <div>
                  <label className="block text-sm font-medium text-[#112d86] mb-1">Asignación</label>
                  <select
                    value={values[asignacionField.field_key] || ""}
                    onChange={(e) => handleChange(asignacionField.field_key, e.target.value)}
                    required={asignacionField.required}
                    disabled={!values[itemField?.field_key]}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40 disabled:bg-[#112d86]/5 disabled:cursor-not-allowed"
                  >
                    <option value="">— Seleccione asignación —</option>
                    {asignacionesPresupuesto.map((a) => (
                      <option key={a.asignacion} value={a.asignacion}>{a.asignacion} — {a.glosa}</option>
                    ))}
                  </select>
                </div>
              )}
              {subtitulos.length === 0 && (
                <p className="text-xs text-[#c8a84e] italic">
                  No hay combinaciones presupuestarias cargadas. Verifique en Datos Maestros.
                </p>
              )}
            </div>
          );
        }

        return (
          <div key={field.field_key}>
            <label
              htmlFor={field.field_key}
              className="block text-sm font-medium text-[#112d86] mb-1"
            >
              {field.field_label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
              {autoFilledKeys.has(field.field_key) && (
                <span className="ml-2 inline-block bg-green-50 text-green-700 border border-green-200 text-[10px] font-medium px-1.5 py-0.5 rounded-full align-middle">
                  Detectado del documento
                </span>
              )}
            </label>
            {renderField(field)}
          </div>
        );
      })}

      {percentageGroups.map(({ group, sum, mismatch }) => (
        <div key={group || "_default"} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
          mismatch ? "bg-red-50 text-red-600 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"
        }`}>
          <span>Suma de porcentajes{group ? ` (${group})` : ""}</span>
          <span>{sum.toFixed(2)}% {mismatch ? "(debe totalizar 100%)" : "✓"}</span>
        </div>
      ))}

      <div className={`flex gap-3 ${onSaveDraft ? "flex-row" : ""}`}>
        {onSaveDraft && (
          <button
            type="button"
            onClick={handleDraft}
            disabled={savingDraft || loading}
            className="flex-1 flex items-center justify-center gap-2 border-2 border-[#112d86]/20 text-[#112d86] py-3 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#112d86]/5 transition-all duration-200"
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
          style={{ background: "linear-gradient(135deg, #112d86, #1a3a9e)" }}
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
