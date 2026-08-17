import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { getTemplate, updateTemplate, reparseTemplate } from "../services/api";
import { useAuth } from "../context/AuthContext";
import FieldEditor from "../components/FieldEditor";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmModal";

export default function TemplateDetail() {
  const { id } = useParams();
  const { isAdmin, isSuperAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function loadTemplate() {
    setLoading(true);
    try {
      const data = await getTemplate(id);
      setTemplate(data);
      setName(data.name);
      setDescription(data.description);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplate();
  }, [id]);

  async function handleUpdateInfo() {
    try {
      await updateTemplate(id, { name, description });
      toast("Plantilla actualizada.", "success");
      setEditName(false);
      loadTemplate();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  async function handleReparse() {
    if (!await confirm("Esto reemplazará los campos actuales con los detectados en el archivo. ¿Continuar?", { confirmLabel: "Re-detectar", title: "Re-detectar campos" }))
      return;
    try {
      await reparseTemplate(id);
      toast("Campos re-detectados exitosamente.", "success");
      loadTemplate();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  }

  if (loading) return <div className="text-center py-12 text-[#112d86]/50">Cargando...</div>;
  if (!template) return <div className="text-center py-12 text-red-500">Plantilla no encontrada</div>;

  return (
    <div className="space-y-6">
      <Link to="/templates" className="text-[#112d86] hover:text-[#1a3a9e] text-sm font-medium">
        &larr; Volver a Plantillas de Bases
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-[#112d86]/10 p-6">
        {isSuperAdmin && editName ? (
          <div className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-2xl font-bold border border-[#112d86]/20 rounded-lg px-3 py-1 w-full focus:ring-2 focus:ring-[#112d86]/30"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción"
              className="border border-[#112d86]/20 rounded-lg px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-[#112d86]/30"
            />
            <div className="flex gap-2">
              <button onClick={handleUpdateInfo} className="bg-[#112d86] text-white px-4 py-1.5 rounded-lg text-sm hover:bg-[#1a3a9e]">
                Guardar
              </button>
              <button onClick={() => setEditName(false)} className="bg-[#112d86]/5 text-[#112d86] px-4 py-1.5 rounded-lg text-sm hover:bg-[#112d86]/10">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-[#112d86]">{template.name}</h1>
              {template.description && <p className="text-[#112d86]/50 mt-1">{template.description}</p>}
              {template.category_name && (
                <span className="inline-block mt-2 bg-[#c8a84e]/10 text-[#8a7232] text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {template.category_name}
                </span>
              )}
              <p className="text-xs text-[#112d86]/30 mt-2">
                Creada: {new Date(template.created_at).toLocaleDateString("es-CL")} |
                Actualizada: {new Date(template.updated_at).toLocaleDateString("es-CL")}
              </p>
            </div>
            <div className="flex gap-2">
              {isSuperAdmin && (
                <>
                  <button onClick={() => setEditName(true)} className="bg-[#112d86]/5 text-[#112d86] px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#112d86]/10">
                    Editar Info
                  </button>
                  <button onClick={handleReparse} className="bg-[#c8a84e]/10 text-[#8a7232] px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#c8a84e]/20 border border-[#c8a84e]/30">
                    Re-detectar Campos
                  </button>
                </>
              )}
              <Link to={`/generate/${template.id}`} className="bg-[#112d86] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-[#1a3a9e]">
                Generar Documento
              </Link>
            </div>
          </div>
        )}
      </div>

      <FieldEditor
        fields={template.fields}
        templateId={template.id}
        onUpdated={loadTemplate}
        readOnly={!isSuperAdmin}
      />
    </div>
  );
}
