// Avisos al dueño del negocio por WhatsApp (si configuró OWNER_PHONE).
import { enviarTexto } from "./whatsapp.js";

export async function notificarDueno(texto) {
  console.log("[aviso]", texto);
  const owner = process.env.OWNER_PHONE;
  if (!owner) return;
  try {
    await enviarTexto(owner, texto);
  } catch (e) {
    // Fuera de la ventana de 24 h Meta no deja enviar texto libre; el panel sigue mostrando todo.
    console.warn("No se pudo avisar al dueño:", e.message);
  }
}
