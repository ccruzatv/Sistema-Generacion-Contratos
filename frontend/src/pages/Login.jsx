import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginApi } from "../services/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await loginApi(email, password);
      login(data.token, data.user);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col justify-between bg-cover bg-center"
      style={{
        // TODO: reemplazar por la foto del edificio Tribunales de Justicia
        // (backgroundImage: "url('/login-bg.jpg')") en cuanto se adjunte el archivo.
        backgroundImage:
          "linear-gradient(160deg, rgba(17,45,134,0.88), rgba(26,58,158,0.72)), linear-gradient(0deg, #eef1f7, #eef1f7)",
      }}
    >
      <div className="flex-1 flex items-center justify-center px-4 py-2 -mt-6 sm:-mt-8">
        <div className="w-full max-w-sm sm:max-w-md">
          {/* Header / Logo */}
          <div className="text-center mb-2">
            <img
              src="/logo-capj-azul.png"
              alt="Corporación Administrativa del Poder Judicial – ccruzatv@pjud.cl"
              className="h-32 sm:h-36 w-auto mx-auto mb-2 object-contain filter drop-shadow-sm bg-white/90 rounded-2xl p-2"
            />
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide leading-tight drop-shadow-sm">
              Sistema de Generación Automatizada de Contratos
            </h1>
            <p className="text-xs sm:text-sm text-white/85 mt-1 tracking-wide font-medium">
              Poder Judicial de Chile
            </p>
          </div>

          {/* Gold accent line */}
          <div className="flex justify-center mb-6">
            <div
              className="h-[2px] w-20 rounded-full"
              style={{ background: "linear-gradient(90deg, transparent, #c8a84e, transparent)" }}
            />
          </div>

          {/* Login card */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl shadow-md border border-[#112d86]/15 p-5 sm:p-6 space-y-3.5 bg-white"
          >
            <h2 className="text-base font-semibold text-[#112d86] text-center">
              Iniciar Sesión
            </h2>

            {error && (
              <div className="bg-red-50 text-red-700 p-2.5 rounded-lg text-xs sm:text-sm border-l-4 border-red-500 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            {/* Email field */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-[#112d86] mb-1">
                Correo electrónico
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[#112d86]/50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="w-full border border-[#112d86]/20 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#112d86]/30 focus:border-[#112d86] transition-all bg-white placeholder-gray-400"
                  placeholder="usuario@pjud.cl"
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-[#112d86] mb-1">
                Contraseña
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-[#112d86]/50">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full border border-[#112d86]/20 rounded-lg pl-9 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#112d86]/30 focus:border-[#112d86] transition-all bg-white placeholder-gray-400"
                  placeholder="Ingrese su contraseña"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#112d86]/50 hover:text-[#112d86] transition-colors"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full text-white py-2.5 px-4 rounded-lg text-sm font-semibold disabled:opacity-50 transition-all duration-200 hover:shadow-lg active:scale-[0.99] cursor-pointer"
              style={{
                background: "linear-gradient(135deg, #112d86 0%, #1a3a9e 100%)",
              }}
            >
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-2.5 shrink-0" style={{ background: "linear-gradient(135deg, #112d86 0%, #1a3a9e 100%)" }}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-1 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-[2px] rounded-full bg-[#c8a84e]/80 hidden sm:block" />
            <p className="text-slate-200 text-[11px] tracking-wide font-light">
              Subdepartamento de Mejoramiento Continuo – DEPLAN
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-slate-200 text-[11px] tracking-wide font-light">
              Corporación Administrativa del Poder Judicial – ccruzatv@pjud.cl
            </p>
            <div className="h-2.5 w-[2px] rounded-full bg-[#c8a84e]/80 hidden sm:block" />
          </div>
        </div>
      </footer>
    </div>
  );
}
