import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation, useNavigate, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ConfirmModal";
import { getNotifications, markAllNotificationsRead } from "./services/api";
import Login from "./pages/Login";
import TemplateList from "./pages/TemplateList";
import TemplateDetail from "./pages/TemplateDetail";
import GenerateDocument from "./pages/GenerateDocument";
import Expedientes from "./pages/Expedientes";
import Expediente from "./pages/Expediente";
import AdminUsers from "./pages/AdminUsers";
import AdminReviews from "./pages/AdminReviews";
import Repository from "./pages/Repository";

const ROLE_LABELS = {
  operativo: "Unidad Requirente",
  admin: "Administrador Jurídico",
  superadmin: "Superadministrador",
};

function ProtectedRoute({ children, adminOnly = false, superOnly = false }) {
  const { user, loading, isAdmin, isSuperAdmin } = useAuth();
  if (loading) return <div className="text-center py-12 text-[#1a2d56]/50">Cargando...</div>;
  if (!user) return <Navigate to="/login" />;
  if (superOnly && !isSuperAdmin) return <Navigate to="/" />;
  if (adminOnly && !isAdmin) return <Navigate to="/" />;
  return children;
}

const BROWSER_NOTIF_SEEN_KEY = "notif_last_seen_id";
const BROWSER_NOTIF_PERMISSION_REQUESTED = "notif_permission_requested";

function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Request browser notification permission once per browser
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default" &&
      !localStorage.getItem(BROWSER_NOTIF_PERMISSION_REQUESTED)
    ) {
      localStorage.setItem(BROWSER_NOTIF_PERMISSION_REQUESTED, "1");
      try {
        Notification.requestPermission().catch(() => {});
      } catch {
        // Some browsers throw on older syntax
      }
    }
    loadNotifications(true);
    const interval = setInterval(() => loadNotifications(false), 30000);
    return () => clearInterval(interval);
  }, []);

  function showBrowserNotifications(newItems) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    for (const n of newItems.slice(0, 3)) {
      try {
        const notif = new Notification("Generación de Contratos", {
          body: n.message,
          icon: "/logo-capj.png",
          tag: `notif-${n.id}`,
        });
        notif.onclick = () => {
          window.focus();
          if (n.link) navigate(n.link);
          notif.close();
        };
      } catch {
        // ignore notification errors
      }
    }
  }

  async function loadNotifications(isFirstLoad) {
    try {
      const data = await getNotifications();
      const lastSeenId = Number(localStorage.getItem(BROWSER_NOTIF_SEEN_KEY) || 0);
      const unreadNew = data.filter((n) => !n.is_read && n.id > lastSeenId);
      if (!isFirstLoad && unreadNew.length > 0) {
        showBrowserNotifications(unreadNew);
      }
      if (data.length > 0) {
        const maxId = Math.max(...data.map((n) => n.id));
        if (maxId > lastSeenId) {
          localStorage.setItem(BROWSER_NOTIF_SEEN_KEY, String(maxId));
        }
      }
      setNotifications(data);
    } catch {
      // silently fail
    }
  }

  const unread = notifications.filter((n) => !n.is_read).length;

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // silently fail
    }
  }

  function handleClick(notif) {
    setOpen(false);
    if (notif.link) navigate(notif.link);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative text-blue-200 hover:text-white p-1.5 rounded transition-colors hover:bg-white/10"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[#c8a84e] text-[#1a2d56] text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-[#1a2d56]/10 z-50 max-h-96 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a2d56]/10">
              <span className="text-sm font-semibold text-[#1a2d56]">Notificaciones</span>
              {unread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-[#1a2d56]/50 hover:text-[#1a2d56]"
                >
                  Marcar todas como leídas
                </button>
              )}
            </div>
            <div className="overflow-y-auto max-h-72">
              {notifications.length === 0 ? (
                <p className="text-center text-[#1a2d56]/40 text-sm py-6">
                  Sin notificaciones
                </p>
              ) : (
                notifications.slice(0, 20).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-[#1a2d56]/5 hover:bg-[#1a2d56]/[0.02] transition-colors ${
                      !n.is_read ? "bg-[#c8a84e]/5" : ""
                    }`}
                  >
                    <p className={`text-xs ${!n.is_read ? "text-[#1a2d56] font-medium" : "text-[#1a2d56]/60"}`}>
                      {n.message}
                    </p>
                    <p className="text-[10px] text-[#1a2d56]/30 mt-1">
                      {new Date(n.created_at).toLocaleDateString("es-CL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AppLayout() {
  const location = useLocation();
  const { user, isAdmin, isSuperAdmin, logout } = useAuth();

  if (!user) return null;

  const navLinks = [
    { to: "/templates", label: "Plantillas", icon: "M4 6a2 2 0 012-2h4.586A2 2 0 0112 4.586L15.414 8A2 2 0 0116 9.414V18a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" },
    { to: "/generate", label: "Generar Contratos", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { to: "/repository", label: "Repositorio", icon: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" },
  ];

  if (isAdmin) {
    navLinks.push({ to: "/admin/reviews", label: "Revisiones", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" });
  }
  if (isSuperAdmin) {
    navLinks.push({ to: "/admin/users", label: "Administración", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" });
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#eef1f7]">
      <header className="shadow-xl" style={{ background: "linear-gradient(135deg, #0f1d3a 0%, #1a2d56 50%, #1e3461 100%)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-[72px]">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/10 group-hover:bg-white/15 transition-colors">
                <img
                  src="/logo-capj-white.svg"
                  alt="CAPJ"
                  className="h-8 w-8"
                />
              </div>
              <div className="leading-tight">
                <span className="text-white text-[14px] font-bold tracking-wide block">
                  Sistema de Generación de Contratos
                </span>
                <span className="text-blue-300/50 text-[10px] block tracking-wider uppercase">
                  Poder Judicial de Chile
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <nav className="flex items-center gap-1 bg-white/[0.06] rounded-xl p-1 backdrop-blur-sm border border-white/[0.08]">
                {navLinks.map((link) => {
                  const isActive = location.pathname === link.to ||
                    (link.to !== "/templates" && location.pathname.startsWith(link.to)) ||
                    (link.to === "/templates" && (location.pathname === "/" || location.pathname === "/templates" || location.pathname.startsWith("/templates/")));
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                        isActive
                          ? "bg-white/20 text-white shadow-sm"
                          : "text-blue-200/70 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={link.icon} />
                      </svg>
                      <span className="hidden lg:inline">{link.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="flex items-center gap-2.5 ml-2 pl-3 border-l border-white/15">
                <NotificationBell />
                <div className="flex items-center gap-2 bg-white/[0.06] rounded-lg px-3 py-1.5 border border-white/[0.08]">
                  <div className="w-7 h-7 rounded-full bg-[#c8a84e]/20 border border-[#c8a84e]/40 flex items-center justify-center flex-shrink-0">
                    <span className="text-[#c8a84e] text-xs font-bold">{user.name?.charAt(0)?.toUpperCase() || "U"}</span>
                  </div>
                  <div className="text-right leading-tight">
                    <span className="text-white text-xs font-semibold block whitespace-nowrap">{user.name}</span>
                    <span className="text-[#c8a84e]/70 text-[10px] block font-medium uppercase tracking-wider">
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="text-blue-200/60 hover:text-white text-xs hover:bg-white/10 px-2 py-1.5 rounded-lg transition-all flex items-center gap-1"
                  title="Cerrar sesión"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="h-[3px]" style={{ background: "linear-gradient(90deg, transparent, #c8a84e 20%, #e0c874 50%, #c8a84e 80%, transparent)" }} />
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<TemplateList />} />
          <Route path="/templates" element={<TemplateList />} />
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/generate" element={<Expedientes />} />
          <Route path="/generate/:templateId" element={<GenerateDocument />} />
          <Route path="/expediente/:bundleId" element={<Expediente />} />
          <Route path="/repository" element={<Repository />} />
          <Route
            path="/admin/reviews"
            element={
              <ProtectedRoute adminOnly>
                <AdminReviews />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute superOnly>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>

      <footer style={{ background: "linear-gradient(135deg, #0f1d3a, #1a2d56)" }}>
        <div className="h-[2px]" style={{ background: "linear-gradient(90deg, transparent, #c8a84e 30%, #e0c874 50%, #c8a84e 70%, transparent)" }} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <p className="text-blue-200/60 text-xs">
            Subdepartamento de Mejoramiento Continuo – ccruzatv@pjud.cl
          </p>
          <p className="text-blue-200/60 text-xs">
            Corporación Administrativa del Poder Judicial
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
