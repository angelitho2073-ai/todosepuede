import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as db from "./db.js";
import { catalogo } from "./agent.js";
import { recibirMensaje, mensajePropio } from "./inbox.js";
import { iniciarWorker, entregar } from "./worker.js";
import { MODO, enviarTexto, extraerMensajes, firmaValida, qrEstado, iniciarQR, codigoVinculacion, cerrarSesion } from "./whatsapp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

// ---------------- Webhook de WhatsApp ----------------
// Meta llama con GET para verificar el webhook.
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  if (MODO !== "api") return res.sendStatus(404);
  if (!firmaValida(req.rawBody, req.get("x-hub-signature-256"))) return res.sendStatus(401);
  res.sendStatus(200); // responder rápido a Meta
  for (const m of extraerMensajes(req.body)) recibirMensaje(m).catch((e) => console.error(e));
});

// ---------------- API del panel (protegida) ----------------
function auth(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "No autorizado" });
  next();
}
const api = express.Router();
api.use(auth);
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message }));

api.get("/resumen", (_req, res) => {
  const pedidos = db.listPedidos();
  const cuenta = (e) => pedidos.filter((p) => p.estado === e).length;
  res.json({
    chats: db.listChats().length,
    pendiente_pago: cuenta("pendiente_pago"),
    en_trabajo: cuenta("en_cola") + cuenta("en_progreso"),
    en_revision: cuenta("en_revision"),
    entregados: cuenta("entregado"),
    errores: cuenta("error"),
    moneda: catalogo().moneda,
  });
});

api.get("/pedidos", (req, res) => res.json(db.listPedidos({ estado: req.query.estado || undefined })));
api.get("/pedidos/:id", (req, res) => {
  const p = db.getPedido(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: "No encontrado" });
});

api.post("/pedidos/:id/pago", wrap(async (req, res) => {
  const p = db.getPedido(req.params.id);
  if (!p) throw new Error("No encontrado");
  const adelanto = Number(req.body.adelanto ?? p.precio_total / 2);
  db.updatePedido(p.id, { estado: "en_cola", adelanto, saldoPendiente: Math.max(0, p.precio_total - adelanto) });
  const msg = `✅ Recibimos tu pago de ${catalogo().moneda}${adelanto} para el pedido ${p.id}. ¡Ya empezamos a trabajar en él! Te aviso apenas esté listo.`;
  await enviarTexto(p.telefono, msg);
  db.addMensaje(p.telefono, "humano", msg);
  res.json(db.getPedido(p.id));
}));

api.post("/pedidos/:id/editar", wrap(async (req, res) => {
  const cambios = {};
  for (const k of ["final", "descripcion", "precio_total", "plazo"]) if (req.body[k] !== undefined) cambios[k] = req.body[k];
  const p = db.updatePedido(req.params.id, cambios);
  if (!p) throw new Error("No encontrado");
  res.json(p);
}));

api.post("/pedidos/:id/rehacer", wrap(async (req, res) => {
  const p = db.updatePedido(req.params.id, { estado: "en_cola", notasRevision: req.body.instrucciones || "" });
  if (!p) throw new Error("No encontrado");
  res.json(p);
}));

api.post("/pedidos/:id/entregar", wrap(async (req, res) => {
  res.json(await entregar(req.params.id, req.body.formato || "auto"));
}));

api.post("/pedidos/:id/cancelar", wrap(async (req, res) => {
  res.json(db.updatePedido(req.params.id, { estado: "cancelado" }));
}));

api.get("/chats", (_req, res) =>
  res.json(db.listChats().map(({ mensajes, ...c }) => ({ ...c, ultimo: mensajes.at(-1)?.texto || "" })))
);
api.get("/chats/:tel", (req, res) => res.json(db.getChat(req.params.tel)));

// El dueño escribe directo al cliente (y el bot queda en pausa en ese chat).
api.post("/chats/:tel/mensaje", wrap(async (req, res) => {
  const texto = String(req.body.texto || "").trim();
  if (!texto) throw new Error("Mensaje vacío");
  await enviarTexto(req.params.tel, texto);
  db.addMensaje(req.params.tel, "humano", texto);
  const chat = db.getChat(req.params.tel);
  if (req.body.pausarBot !== false) chat.botActivo = false;
  db.save();
  res.json(chat);
}));

api.post("/chats/:tel/bot", (req, res) => {
  const chat = db.getChat(req.params.tel);
  chat.botActivo = !!req.body.activo;
  db.save();
  res.json(chat);
});

// Conexión de WhatsApp (modo QR)
api.get("/conexion", (_req, res) => res.json({ modo: MODO, ...(MODO === "qr" ? qrEstado : { conectado: true }) }));
api.post("/conexion/codigo", wrap(async (req, res) => res.json({ codigo: await codigoVinculacion(String(req.body.numero || "")) })));
api.post("/conexion/salir", wrap(async (_req, res) => {
  await cerrarSesion();
  setTimeout(() => iniciarQR({ mensaje: recibirMensaje, propio: mensajePropio }).catch(console.error), 1000);
  res.json({ ok: true });
}));

api.get("/media/:archivo", (req, res) => res.sendFile(db.rutaMedia(req.params.archivo)));

api.get("/catalogo", (_req, res) => res.json(catalogo()));
api.put("/catalogo", wrap(async (req, res) => {
  if (!req.body?.servicios) throw new Error("El catálogo debe tener 'servicios'");
  fs.writeFileSync(process.env.CATALOGO_PATH || "./catalogo.json", JSON.stringify(req.body, null, 2));
  res.json(catalogo());
}));

app.use("/api", api);
app.use("/", express.static(path.join(here, "..", "public")));
app.get("/salud", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Bot de WhatsApp escuchando en http://localhost:${PORT}`);
  console.log(`Panel: http://localhost:${PORT}/  |  Webhook: /webhook`);
  if (!process.env.ADMIN_TOKEN) console.warn("⚠️  Define ADMIN_TOKEN en .env para usar el panel.");
  iniciarWorker();
  if (MODO === "qr") {
    iniciarQR({ mensaje: recibirMensaje, propio: mensajePropio }).catch((e) => console.error("Error iniciando WhatsApp:", e));
  } else {
    console.log("Modo API oficial: configura el webhook en Meta apuntando a /webhook");
  }
});
