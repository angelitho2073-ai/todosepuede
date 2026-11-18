// Elige cómo se conecta WhatsApp según WHATSAPP_MODO:
//   "qr"  (por defecto) → escaneas un QR como WhatsApp Web; tu celular sigue funcionando.
//   "api"               → API oficial de Meta (WhatsApp Business Platform).
import * as api from "./wa-api.js";
import * as qr from "./wa-qr.js";

export const MODO = (process.env.WHATSAPP_MODO || "qr").toLowerCase() === "api" ? "api" : "qr";
const c = MODO === "api" ? api : qr;

export const enviarTexto = (...a) => c.enviarTexto(...a);
export const enviarDocumento = (...a) => c.enviarDocumento(...a);
export const marcarLeido = (...a) => c.marcarLeido(...a);

// Solo modo API
export const firmaValida = api.firmaValida;
export const extraerMensajes = api.extraerMensajes;

// Solo modo QR
export const qrEstado = qr.estado;
export const iniciarQR = qr.iniciar;
export const codigoVinculacion = qr.codigoVinculacion;
export const cerrarSesion = qr.cerrarSesion;

// Número que se muestra en el panel (en modo QR el id interno es "51999...@s.whatsapp.net").
export const numeroDe = (id) => String(id).split("@")[0].split(":")[0];
