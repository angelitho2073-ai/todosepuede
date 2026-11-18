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
export function getChat(telefono, nombre) {
  if (!db.chats[telefono]) {
    db.chats[telefono] = {
      telefono,
      nombre: nombre || "",
      botActivo: true, // false = un humano tomó el control
      mensajes: [], // { rol: "cliente"|"bot"|"humano", texto, fecha }
      ultimaActividad: null,
      ultimoMensajeCliente: null,
    };
  }
  if (nombre && !db.chats[telefono].nombre) db.chats[telefono].nombre = nombre;
  return db.chats[telefono];
}

export function addMensaje(telefono, rol, texto) {
  const chat = getChat(telefono);
  const fecha = new Date().toISOString();
  chat.mensajes.push({ rol, texto, fecha });
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
