import { JURISDICCIONES } from "../constants/jurisdicciones";

export default function JurisdiccionSelector({ value, onChange, required = true }) {
  const isMissing = required && !value;
  return (
    <div>
      <label className="block text-sm font-medium text-[#112d86] mb-1">
        Jurisdicción{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 bg-white ${
          isMissing
            ? "border-red-400 bg-red-50 focus:ring-red-300 focus:border-red-400 text-red-500"
            : "border-[#112d86]/20 focus:ring-[#112d86]/30 focus:border-[#112d86]/40 text-[#112d86]"
        }`}
      >
        <option value="">— Seleccione una jurisdicción —</option>
        {JURISDICCIONES.map((j) => (
          <option key={j} value={j}>{j}</option>
        ))}
      </select>
    </div>
  );
}
