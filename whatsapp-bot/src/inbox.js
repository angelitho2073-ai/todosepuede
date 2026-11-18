// Recibe mensajes de cualquier conector (QR o API) y decide cuándo responde el bot.
import * as db from "./db.js";
import { responder } from "./agent.js";
import { enviarTexto, marcarLeido } from "./whatsapp.js";

const AGRUPAR_MS = Number(process.env.AGRUPAR_MS || 5000);
const PAUSA_HUMANO_H = Number(process.env.HUMANO_PAUSA_HORAS || 6);

// Cola por cliente: sus mensajes se atienden en orden, uno a la vez.
const colas = new Map();
function encolar(telefono, fn) {
  const prev = colas.get(telefono) || Promise.resolve();
  const next = prev.then(fn).catch((e) => console.error("Error atendiendo", telefono, e));
  colas.set(telefono, next);
  next.finally(() => colas.get(telefono) === next && colas.delete(telefono));
}

function botPuedeResponder(chat) {
  if (process.env.BOT_PAUSADO === "true") return false;
  if (chat.botActivo) return true;
  // Si lo pausaste escribiendo tú, se reactiva solo pasado un tiempo.
  if (chat.pausaHasta && new Date(chat.pausaHasta) < new Date()) {
    chat.botActivo = true;
    chat.pausaHasta = null;
    db.save();
    return true;
  }
  return false;
}

// Espera unos segundos por si el cliente manda varios mensajes seguidos y responde a todos juntos.
const temporizadores = new Map();

export async function recibirMensaje({ id, telefono, numero, nombre, texto, imagen, clave }) {
  if (id && db.yaProcesado(id)) return;
  const chat = db.getChat(telefono, nombre, numero);
  db.addMensaje(telefono, "cliente", texto || "", { imagen });
  marcarLeido(id, clave);
  if (botPuedeResponder(chat)) programarRespuesta(telefono);
}

function programarRespuesta(telefono) {
  clearTimeout(temporizadores.get(telefono));
  temporizadores.set(
    telefono,
    setTimeout(() => {
      temporizadores.delete(telefono);
      encolar(telefono, async () => {
        const respuesta = await responder(telefono);
        if (!respuesta || !botPuedeResponder(db.getChat(telefono))) return;
        await enviarTexto(telefono, respuesta);
        db.addMensaje(telefono, "bot", respuesta);
      });
    }, AGRUPAR_MS)
  );
}

// Tú escribiste desde tu celular a un cliente: el bot se hace a un lado un rato.
export async function mensajePropio({ telefono, texto }) {
  const chat = db.getChat(telefono);
  db.addMensaje(telefono, "humano", texto);
  chat.botActivo = false;
  chat.pausaHasta = PAUSA_HUMANO_H > 0 ? new Date(Date.now() + PAUSA_HUMANO_H * 3600e3).toISOString() : null;
  clearTimeout(temporizadores.get(telefono));
  db.save();
}
