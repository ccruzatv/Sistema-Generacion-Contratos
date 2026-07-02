import { useState, useEffect } from "react";
import { getUsers, createUser, updateUser, deleteUser } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";
import { JURISDICCIONES } from "../constants/jurisdicciones";

const ROLE_LABELS = {
  operativo: "Unidad Requirente",
  admin: "Administrador Jurídico",
  superadmin: "Superadministrador",
};

const ROLE_NEEDS_JURISDICTION = ["admin", "operativo"];

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "operativo", password: "", jurisdiccion: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetModal, setResetModal] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [resetting, setResetting] = useState(false);
  const [filterJur, setFilterJur] = useState("");

  async function loadUsers() {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const payload = { ...form, jurisdiccion: form.jurisdiccion || null };
      await createUser(payload);
      toast("Usuario creado exitosamente.", "success");
      setForm({ email: "", name: "", role: "operativo", password: "", jurisdiccion: "" });
      setShowInvite(false);
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(u) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      loadUsers();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handleChangeRole(u, newRole) {
    try {
      await updateUser(u.id, { role: newRole });
      loadUsers();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handleChangeJurisdiccion(u, newJur) {
    try {
      await updateUser(u.id, { jurisdiccion: newJur || null });
      loadUsers();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handleDelete(u) {
    if (!await confirm(`¿Eliminar al usuario "${u.name}" (${u.email})?`, { confirmLabel: "Eliminar", danger: true, title: "Eliminar usuario" })) return;
    try {
      await deleteUser(u.id);
      toast("Usuario eliminado.", "success");
      loadUsers();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!resetModal || !resetPw.trim()) return;
    setResetting(true);
    try {
      await updateUser(resetModal.id, { password: resetPw.trim() });
      toast("Contraseña actualizada.", "success");
      setResetModal(null);
      setResetPw("");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setResetting(false);
    }
  }

  // Group users by jurisdiction for summary cards
  const jurSummary = JURISDICCIONES.map((jur) => {
    const admins = users.filter((u) => u.jurisdiccion === jur && u.role === "admin" && u.is_active);
    const ops = users.filter((u) => u.jurisdiccion === jur && u.role === "operativo" && u.is_active);
    return { jur, admins: admins.length, ops: ops.length };
  }).filter((s) => s.admins > 0 || s.ops > 0);

  const filteredUsers = filterJur
    ? users.filter((u) => u.jurisdiccion === filterJur)
    : users;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2d56]">Administración de Usuarios</h1>
          <p className="text-sm text-[#1a2d56]/60 mt-1">Gestione el acceso al sistema por jurisdicción</p>
        </div>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-2 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            {showInvite
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />}
          </svg>
          {showInvite ? "Cerrar" : "Invitar Usuario"}
        </button>
      </div>

      {/* Jurisdiction summary cards */}
      {jurSummary.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-[#1a2d56]/50 uppercase tracking-wider mb-2">Resumen por Jurisdicción</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {jurSummary.map(({ jur, admins, ops }) => (
              <button
                key={jur}
                onClick={() => setFilterJur(filterJur === jur ? "" : jur)}
                className={`text-left p-3 rounded-xl border-2 transition-all ${
                  filterJur === jur
                    ? "border-[#c8a84e] bg-[#c8a84e]/5"
                    : "border-[#1a2d56]/10 bg-white hover:border-[#1a2d56]/20"
                }`}
              >
                <div className="text-xs font-semibold text-[#1a2d56] truncate">{jur}</div>
                <div className="flex gap-2 mt-1">
                  <span className="text-[10px] text-[#1a2d56]/50">{admins} admin</span>
                  <span className="text-[10px] text-[#1a2d56]/50">{ops} op.</span>
                </div>
              </button>
            ))}
          </div>
          {filterJur && (
            <button onClick={() => setFilterJur("")} className="mt-1 text-xs text-[#1a2d56]/50 hover:text-[#1a2d56]">
              × Limpiar filtro
            </button>
          )}
        </div>
      )}

      {/* Create user form */}
      {showInvite && (
        <form onSubmit={handleInvite} className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[#1a2d56]">Invitar Nuevo Usuario</h2>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#1a2d56] mb-1">Nombre completo</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
                placeholder="Juan Pérez"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1a2d56] mb-1">Correo electrónico</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
                placeholder="usuario@pjud.cl"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1a2d56] mb-1">Contraseña temporal</label>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
                placeholder="Contraseña inicial"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1a2d56] mb-1">Rol</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
              >
                <option value="operativo">Unidad Requirente</option>
                <option value="admin">Administrador Jurídico</option>
                <option value="superadmin">Superadministrador</option>
              </select>
            </div>
            {ROLE_NEEDS_JURISDICTION.includes(form.role) && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[#1a2d56] mb-1">
                  Jurisdicción <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.jurisdiccion}
                  onChange={(e) => setForm({ ...form, jurisdiccion: e.target.value })}
                  required
                  className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
                >
                  <option value="">— Seleccione jurisdicción —</option>
                  {JURISDICCIONES.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 text-white py-2.5 px-6 rounded-xl text-sm font-semibold disabled:opacity-50 shadow-md hover:shadow-lg transition-all duration-200"
            style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg>
            {submitting ? "Creando..." : "Crear Usuario"}
          </button>
        </form>
      )}

      {/* Users table */}
      {loading ? (
        <div className="text-center py-8 text-[#1a2d56]/50">Cargando usuarios...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-[#1a2d56]/10 overflow-hidden">
          <table className="w-full">
            <thead style={{ background: "linear-gradient(135deg, #1a2d56, #243b6e)" }}>
              <tr>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Usuario</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Jurisdicción</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Rol</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Estado</th>
                <th className="py-3.5 px-4 text-left text-[11px] font-semibold text-white/90 uppercase tracking-wider">Creado</th>
                <th className="py-3.5 px-4 text-right text-[11px] font-semibold text-white/90 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-t border-[#1a2d56]/5 hover:bg-[#1a2d56]/[0.02]">
                  <td className="py-3 px-4">
                    <div className="font-medium text-[#1a2d56] text-sm">{u.name}</div>
                    <div className="text-xs text-[#1a2d56]/40">{u.email}</div>
                  </td>
                  <td className="py-3 px-4">
                    {u.id === currentUser.id || u.role === "superadmin" ? (
                      <span className="text-xs text-[#1a2d56]/40 italic">
                        {u.role === "superadmin" ? "Todas" : u.jurisdiccion || "—"}
                      </span>
                    ) : (
                      <select
                        value={u.jurisdiccion || ""}
                        onChange={(e) => handleChangeJurisdiccion(u, e.target.value)}
                        className="border border-[#1a2d56]/20 rounded-lg px-2 py-1 text-xs min-w-[130px]"
                      >
                        <option value="">— Sin asignar —</option>
                        {JURISDICCIONES.map((j) => (
                          <option key={j} value={j}>{j}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {u.id === currentUser.id ? (
                      <span className="inline-block bg-[#c8a84e]/15 text-[#8a7232] text-xs font-medium px-2.5 py-0.5 rounded-full">
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u, e.target.value)}
                        className="border border-[#1a2d56]/20 rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="operativo">Unidad Requirente</option>
                        <option value="admin">Administrador Jurídico</option>
                        <option value="superadmin">Superadministrador</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-block text-xs font-medium px-2.5 py-0.5 rounded-full ${
                      u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {u.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-[#1a2d56]/40">
                    {new Date(u.created_at).toLocaleDateString("es-CL")}
                  </td>
                  <td className="py-3 px-4 text-right space-x-1">
                    {u.id !== currentUser.id && (
                      <>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`text-xs py-1 px-2 rounded-lg ${u.is_active ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-600 hover:bg-green-100"}`}
                        >
                          {u.is_active ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          onClick={() => { setResetModal(u); setResetPw(""); }}
                          className="text-xs py-1 px-2 rounded-lg bg-[#1a2d56]/5 text-[#1a2d56] hover:bg-[#1a2d56]/10"
                        >
                          Contraseña
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          className="text-xs py-1 px-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-[#1a2d56]/40">
                    No hay usuarios{filterJur ? ` en ${filterJur}` : ""}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reset password modal */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleResetPassword} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div>
              <h3 className="text-base font-bold text-[#1a2d56]">Cambiar contraseña</h3>
              <p className="text-sm text-[#1a2d56]/60 mt-1">{resetModal.name} — {resetModal.email}</p>
            </div>
            <input
              type="text"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
              required
              placeholder="Nueva contraseña"
              className="w-full border border-[#1a2d56]/20 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1a2d56]/30"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setResetModal(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-[#1a2d56]/60 hover:bg-[#1a2d56]/5">
                Cancelar
              </button>
              <button type="submit" disabled={resetting || !resetPw.trim()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#1a2d56] hover:bg-[#243b6e] disabled:opacity-50">
                {resetting ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
