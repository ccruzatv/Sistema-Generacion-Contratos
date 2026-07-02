import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onRemove }) {
  const styles = {
    success: { bar: "bg-green-500", icon: "✓", bg: "bg-white border-green-200", text: "text-green-700" },
    error:   { bar: "bg-red-500",   icon: "✕", bg: "bg-white border-red-200",   text: "text-red-700"   },
    info:    { bar: "bg-[#1a2d56]", icon: "i", bg: "bg-white border-[#1a2d56]/20", text: "text-[#1a2d56]" },
    warning: { bar: "bg-[#c8a84e]", icon: "!", bg: "bg-white border-[#c8a84e]/30", text: "text-[#9a7a28]" },
  };
  const s = styles[toast.type] || styles.info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border shadow-lg px-4 py-3 min-w-[260px] max-w-sm ${s.bg}`}
      style={{ animation: "slideInRight 0.2s ease" }}
    >
      <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${s.bar}`}>
        {s.icon}
      </span>
      <p className={`text-sm flex-1 leading-snug ${s.text}`}>{toast.message}</p>
      <button onClick={() => onRemove(toast.id)} className="text-gray-300 hover:text-gray-500 text-lg leading-none mt-0.5 flex-shrink-0">×</button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
