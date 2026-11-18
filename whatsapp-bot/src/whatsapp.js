// Cliente mínimo de la API oficial de WhatsApp Business (Meta Cloud API).
import crypto from "crypto";

const VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";
const BASE = `${process.env.WHATSAPP_API_BASE || "https://graph.facebook.com"}/${VERSION}`;

function cfg() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en .env");
  return { token, phoneId };
}

async function graph(pathname, body, isForm = false) {
  const { token } = cfg();
  const res = await fetch(`${BASE}/${pathname}`, {
    method: "POST",
    headers: isForm
      ? { Authorization: `Bearer ${token}` }
      : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${json?.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

// WhatsApp corta en 4096 caracteres: dividimos por párrafos.
function trocear(texto, max = 3800) {
  const partes = [];
  let actual = "";
  for (const parrafo of texto.split(/\n{2,}/)) {
    if ((actual + "\n\n" + parrafo).length > max && actual) {
      partes.push(actual);
      actual = parrafo;
    } else {
      actual = actual ? actual + "\n\n" + parrafo : parrafo;
    }
  }
  if (actual) partes.push(actual);
  return partes.flatMap((p) => (p.length > max ? p.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) : [p]));
}

export async function enviarTexto(telefono, texto) {
  const { phoneId } = cfg();
  for (const parte of trocear(texto)) {
    await graph(`${phoneId}/messages`, {
      messaging_product: "whatsapp",
      to: telefono,
      type: "text",
      text: { body: parte, preview_url: false },
    });
  }
}

export async function enviarDocumento(telefono, buffer, nombreArchivo, mime, caption) {
  const { phoneId } = cfg();
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buffer], { type: mime }), nombreArchivo);
  const { id } = await graph(`${phoneId}/media`, form, true);
  await graph(`${phoneId}/messages`, {
    messaging_product: "whatsapp",
    to: telefono,
    type: "document",
    document: { id, filename: nombreArchivo, caption },
  });
}

export async function marcarLeido(messageId) {
  const { phoneId } = cfg();
  await graph(`${phoneId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  }).catch(() => {});
}

// Verifica la firma X-Hub-Signature-256 que envía Meta (si configuraste WHATSAPP_APP_SECRET).
export function firmaValida(rawBody, firma) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!firma) return false;
  const esperado = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(esperado);
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrae los mensajes entrantes del payload del webhook.
export function extraerMensajes(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        let texto = "";
        if (m.type === "text") texto = m.text?.body || "";
        else if (m.type === "button") texto = m.button?.text || "";
        else if (m.type === "interactive")
          texto = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
        else if (m.type === "image" || m.type === "document")
          texto = `[El cliente envió un ${m.type === "image" ? "imagen" : "documento"}${m[m.type]?.caption ? ": " + m[m.type].caption : ""}]`;
        else if (m.type === "audio") texto = "[El cliente envió un audio de voz]";
        else texto = `[Mensaje de tipo ${m.type}]`;
        out.push({ id: m.id, telefono: m.from, nombre: nombres[m.from] || "", texto });
      }
    }
  }
  return out;
}
