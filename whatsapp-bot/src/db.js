// Almacenamiento simple en un archivo JSON (suficiente para un negocio pequeño).
import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR || "./data";
const FILE = path.join(DATA_DIR, "db.json");

const empty = () => ({ chats: {}, pedidos: [], procesados: [] });

let db = empty();
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
} catch (e) {
  console.error("No se pudo leer la base de datos, se inicia vacía:", e.message);
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  }, 200);
}

// ---------- Chats ----------
export function getChat(telefono, nombre, numero) {
  if (!db.chats[telefono]) {
    db.chats[telefono] = {
      telefono, // id para enviar (en modo QR: "51999...@s.whatsapp.net")
      numero: numero || String(telefono).split("@")[0], // número visible
      nombre: nombre || "",
      botActivo: true, // false = un humano tomó el control
      pausaHasta: null, // si lo pausaste escribiendo tú, cuándo se reactiva solo
      mensajes: [], // { rol: "cliente"|"bot"|"humano", texto, fecha }
      ultimaActividad: null,
      ultimoMensajeCliente: null,
    };
  }
  const c = db.chats[telefono];
  if (nombre && !c.nombre) c.nombre = nombre;
  if (numero && numero !== c.numero) c.numero = numero;
  return c;
}

// Las imágenes se guardan como archivo (no dentro del JSON) para que Claude pueda verlas.
const MEDIA_DIR = path.join(DATA_DIR, "media");
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export function addMensaje(telefono, rol, texto, { imagen } = {}) {
  const chat = getChat(telefono);
  const fecha = new Date().toISOString();
  const msg = { rol, texto, fecha };
  if (imagen && EXT[imagen.media_type]) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const nombre = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${EXT[imagen.media_type]}`;
    fs.writeFileSync(path.join(MEDIA_DIR, nombre), Buffer.from(imagen.data, "base64"));
    msg.imagen = { archivo: nombre, media_type: imagen.media_type };
  }
  chat.mensajes.push(msg);
  chat.ultimaActividad = fecha;
  if (rol === "cliente") chat.ultimoMensajeCliente = fecha;
  save();
}

export function listChats() {
  return Object.values(db.chats).sort((a, b) =>
    (b.ultimaActividad || "").localeCompare(a.ultimaActividad || "")
  );
}

// Evita procesar dos veces el mismo mensaje (Meta reintenta los webhooks).
export function yaProcesado(id) {
  if (db.procesados.includes(id)) return true;
  db.procesados.push(id);
  if (db.procesados.length > 2000) db.procesados = db.procesados.slice(-1000);
  save();
  return false;
}

// ---------- Pedidos ----------
// Estados: pendiente_pago -> en_cola -> en_progreso -> en_revision -> entregado
//          (también: error, cancelado)
export function crearPedido(data) {
  const pedido = {
    id: "P" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase(),
    estado: "pendiente_pago",
    creado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
    borrador: "",
    final: "",
    notasRevision: "",
    historial: [],
    ...data,
  };
  db.pedidos.unshift(pedido);
  save();
  return pedido;
}

export function getPedido(id) {
  return db.pedidos.find((p) => p.id === id);
}

export function updatePedido(id, cambios) {
  const p = getPedido(id);
  if (!p) return null;
  if (cambios.estado && cambios.estado !== p.estado) {
    p.historial.push({ de: p.estado, a: cambios.estado, fecha: new Date().toISOString() });
  }
  Object.assign(p, cambios, { actualizado: new Date().toISOString() });
  save();
  return p;
}

export function listPedidos(filtro = {}) {
  return db.pedidos.filter((p) =>
    Object.entries(filtro).every(([k, v]) => v === undefined || p[k] === v)
  );
}

export function leerImagen(img) {
  try {
    return fs.readFileSync(path.join(MEDIA_DIR, path.basename(img.archivo))).toString("base64");
  } catch {
    return null;
  }
}
export const rutaMedia = (archivo) => path.resolve(MEDIA_DIR, path.basename(archivo));
