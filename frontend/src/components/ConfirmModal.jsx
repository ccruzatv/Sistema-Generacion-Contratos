import { createContext, useContext, useState, useCallback } from "react";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [modal, setModal] = useState(null);

  const confirm = useCallback((message, { title = "Confirmar", confirmLabel = "Confirmar", danger = false } = {}) => {
    return new Promise((resolve) => {
      setModal({ message, title, confirmLabel, danger, resolve });
    });
  }, []);

  function handleClose(result) {
    modal?.resolve(result);
    setModal(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9998] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div>
              <h3 className="text-base font-bold text-[#1a2d56]">{modal.title}</h3>
              <p className="text-sm text-[#1a2d56]/70 mt-1 leading-snug">{modal.message}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[#1a2d56]/60 hover:bg-[#1a2d56]/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:shadow-md ${
                  modal.danger
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-[#1a2d56] hover:bg-[#243b6e]"
                }`}
              >
                {modal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}
