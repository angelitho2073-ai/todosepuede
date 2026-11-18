// Conector "qr": vincula tu WhatsApp (normal o Business) escaneando un código QR,
// igual que WhatsApp Web. Tu celular sigue funcionando con normalidad.
// Usa la librería no oficial Baileys: WhatsApp puede bloquear números que envían
// spam o mensajes masivos. Úsalo solo para responder a quien te escribe.
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import pino from "pino";
import { HttpsProxyAgent } from "https-proxy-agent";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "baileys";

const DATA_DIR = process.env.DATA_DIR || "./data";
const AUTH_DIR = path.join(DATA_DIR, "sesion-whatsapp");
const logger = pino({ level: process.env.LOG_BAILEYS || "silent" });

let sock = null;
let handlers = { mensaje: async () => {}, propio: async () => {} };
const enviadosPorBot = new Set(); // ids de mensajes enviados por el bot (para distinguirlos de los tuyos)

export const estado = { conectado: false, qr: null, numero: null, nombre: null, error: null };

function recordarEnviado(r) {
  if (r?.key?.id) {
    enviadosPorBot.add(r.key.id);
    if (enviadosPorBot.size > 500) enviadosPorBot.delete(enviadosPorBot.values().next().value);
  }
}

const aJid = (destino) => (destino.includes("@") ? destino : `${destino.replace(/\D/g, "")}@s.whatsapp.net`);

export function numeroVisible(jid, alt) {
  const pn = isPnUser(jid) ? jid : isPnUser(alt) ? alt : null;
  return pn ? jidDecode(pn).user : jidDecode(jid)?.user || jid;
}

async function extraer(m) {
  const c = normalizeMessageContent(m.message);
  if (!c) return null;
  let texto = c.conversation || c.extendedTextMessage?.text || "";
  let imagen = null;
  if (c.imageMessage) {
    texto = c.imageMessage.caption || "";
    try {
      const buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      imagen = { media_type: c.imageMessage.mimetype?.split(";")[0] || "image/jpeg", data: buf.toString("base64") };
    } catch {
      texto = "[El cliente envió una imagen que no se pudo descargar] " + texto;
    }
  } else if (c.documentMessage) texto = `[El cliente envió el documento "${c.documentMessage.fileName || ""}"] ${c.documentMessage.caption || ""}`;
  else if (c.audioMessage) texto = "[El cliente envió un audio de voz]";
  else if (c.videoMessage) texto = "[El cliente envió un video] " + (c.videoMessage.caption || "");
  else if (c.stickerMessage) texto = "[El cliente envió un sticker]";
  else if (c.locationMessage) texto = "[El cliente envió su ubicación]";
  else if (c.buttonsResponseMessage) texto = c.buttonsResponseMessage.selectedDisplayText || "";
  else if (c.listResponseMessage) texto = c.listResponseMessage.title || "";
  else if (c.reactionMessage || c.protocolMessage) return null; // reacciones, borrados, etc.
  if (!texto.trim() && !imagen) return null;
  return { texto: texto.trim(), imagen };
}

export async function iniciar(h) {
  handlers = { ...handlers, ...h };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  // Si el servidor sale a internet por un proxy (HTTPS_PROXY), WhatsApp también debe usarlo.
  const proxy = process.env.WHATSAPP_PROXY || process.env.HTTPS_PROXY;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

  sock = makeWASocket({
    version,
    agent,
    fetchAgent: agent,
    auth: state,
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false, // así tu celular sigue recibiendo notificaciones
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      estado.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      estado.conectado = false;
      estado.error = null;
      console.log("📱 Escanea el código QR desde el panel (pestaña Conexión).");
    }
    if (u.connection === "open") {
      Object.assign(estado, { conectado: true, qr: null, error: null, numero: jidDecode(sock.user?.id)?.user, nombre: sock.user?.name });
      console.log(`✅ WhatsApp conectado: +${estado.numero}`);
    }
    if (u.connection === "close") {
      estado.conectado = false;
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.restartRequired) estado.error = "Sin conexión con WhatsApp, reintentando… (revisa el internet del servidor)";
      if (code === DisconnectReason.loggedOut) {
        console.warn("WhatsApp cerró la sesión. Se generará un nuevo QR.");
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        estado.error = "Sesión cerrada desde el celular. Escanea el nuevo QR.";
      }
      setTimeout(() => iniciar(handlers).catch((e) => (estado.error = e.message)), code === DisconnectReason.restartRequired ? 0 : 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // ignorar historial antiguo
    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || jid.endsWith("@newsletter")) continue;
      const datos = await extraer(m).catch(() => null);
      if (!datos) continue;
      if (m.key.fromMe) {
        if (enviadosPorBot.has(m.key.id)) continue;
        // Escribiste tú desde el celular: el bot se hace a un lado en ese chat.
        await handlers.propio({ telefono: jid, texto: datos.texto || "[imagen]" });
        continue;
      }
      await handlers.mensaje({
        id: m.key.id,
        telefono: jid,
        numero: numeroVisible(jid, m.key.remoteJidAlt),
        nombre: m.pushName || "",
        texto: datos.texto,
        imagen: datos.imagen,
        clave: m.key,
      });
    }
  });
}

function listo() {
  if (!sock || !estado.conectado) throw new Error("WhatsApp no está conectado. Escanea el QR en el panel.");
  return sock;
}

export async function enviarTexto(destino, texto) {
  const s = listo();
  const jid = aJid(destino);
  // "Escribiendo..." breve para que se sienta natural
  await s.sendPresenceUpdate("composing", jid).catch(() => {});
  await new Promise((r) => setTimeout(r, Math.min(3000, 600 + texto.length * 15)));
  await s.sendPresenceUpdate("paused", jid).catch(() => {});
  recordarEnviado(await s.sendMessage(jid, { text: texto }));
}

export async function enviarDocumento(destino, buffer, nombreArchivo, mime, caption) {
  recordarEnviado(await listo().sendMessage(aJid(destino), { document: buffer, mimetype: mime, fileName: nombreArchivo, caption }));
}

export async function marcarLeido(_id, clave) {
  if (clave && sock && estado.conectado) await sock.readMessages([clave]).catch(() => {});
}

export async function codigoVinculacion(numero) {
  if (!sock) throw new Error("El conector aún no inició");
  if (estado.conectado) throw new Error("Ya está conectado");
  return sock.requestPairingCode(numero.replace(/\D/g, ""));
}

export async function cerrarSesion() {
  if (sock) await sock.logout().catch(() => {});
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  Object.assign(estado, { conectado: false, numero: null, nombre: null });
}
