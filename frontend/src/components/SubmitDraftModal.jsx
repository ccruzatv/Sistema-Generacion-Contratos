import { useEffect, useState } from "react";
import { getSubmitContext, submitDraft } from "../services/api";

// Mejora M3 (acta Departamento Jurídico 02.10.2026): antes de enviar un
// borrador a revisión, el usuario indica la carpeta virtual de antecedentes
// del contrato y declara que contiene los antecedentes que validan la
// información ingresada. Si el expediente ya tiene la carpeta registrada, se
// precarga.
export default function SubmitDraftModal({ documentId, initialComment = "", showComment = true, onClose, onSubmitted }) {
  const [context, setContext] = useState(null);
  const [carpetaUrl, setCarpetaUrl] = useState("");
  const [confirmados, setConfirmados] = useState(false);
  const [comment, setComment] = useState(initialComment);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getSubmitContext(documentId)
      .then((data) => {
        if (!active) return;
        setContext(data);
        setCarpetaUrl(data.carpeta_url || "");
      })
      .catch(() => active && setContext({}));
    return () => {
      active = false;
    };
  }, [documentId]);

  const urlValida = /^https:\/\/\S+$/i.test(carpetaUrl.trim());
  const puedeEnviar = urlValida && confirmados && !sending;

  async function handleSubmit() {
    if (!puedeEnviar) return;
    setSending(true);
    setError("");
    try {
      await submitDraft(documentId, comment.trim(), { carpetaUrl: carpetaUrl.trim(), confirmados });
      onSubmitted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9998] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-[#112d86]">Enviar borrador a revisión</h3>
          <p className="text-sm text-[#112d86]/70 mt-1 leading-snug">
            Indique la carpeta virtual con los antecedentes del contrato antes de enviarlo a revisión de jefatura.
          </p>
        </div>

        {context?.expediente_correlativo && (
          <div className="text-xs text-[#112d86]/70 bg-[#112d86]/[0.03] border border-[#112d86]/10 rounded-lg px-3 py-2">
            Expediente N° {context.expediente_correlativo}
            {context.sgf_id ? <span> · ID SGF: <span className="font-semibold">{context.sgf_id}</span></span> : <span className="text-[#c8a84e]"> · Sin ID de SGF registrado</span>}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#112d86] mb-1">
            Enlace a la carpeta de antecedentes <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            value={carpetaUrl}
            onChange={(e) => setCarpetaUrl(e.target.value)}
            placeholder="https://..."
            className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#112d86]/30"
          />
          {carpetaUrl && !urlValida && (
            <p className="text-[11px] text-red-600 mt-1">El enlace debe comenzar con https://</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-[#112d86]/80 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmados}
            onChange={(e) => setConfirmados(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Declaro que la carpeta indicada existe y contiene los antecedentes que validan la información del contrato.
          </span>
        </label>

        {showComment && (
          <div>
            <label className="block text-sm font-medium text-[#112d86] mb-1">Comentario para el revisor (opcional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full border border-[#112d86]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#112d86]/30"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[#112d86]/60 hover:bg-[#112d86]/5 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!puedeEnviar}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-all disabled:opacity-50"
          >
            {sending ? "Enviando..." : "Enviar a revisión"}
          </button>
        </div>
      </div>
    </div>
  );
}
