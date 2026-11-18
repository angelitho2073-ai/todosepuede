// Agente que atiende a los clientes por WhatsApp: conversa, responde cualquier
// pregunta, cotiza, registra pedidos y hace seguimiento.
import fs from "fs";
import { crear, textoDe } from "./claude.js";
import * as db from "./db.js";
import { notificarDueno } from "./notify.js";

const CATALOGO_PATH = process.env.CATALOGO_PATH || "./catalogo.json";
export const catalogo = () => JSON.parse(fs.readFileSync(CATALOGO_PATH, "utf8"));

const REQUIERE_PAGO = (process.env.REQUIERE_PAGO ?? "true") === "true";
const ESFUERZO = process.env.CLAUDE_ESFUERZO_CHAT || "medium"; // low | medium | high

function systemPrompt() {
  const c = catalogo();
  const nombreAsistente = c.asistente || "Sofía";
  return `Eres ${nombreAsistente}, la asistente de "${c.negocio}" en WhatsApp. Conversas con clientes reales y tu trabajo es que cada persona sienta que habla con alguien atento que entiende exactamente lo que preguntó.

# Responde todo lo que te pregunten
- Lee el mensaje completo del cliente (a veces manda varios seguidos) y responde a cada pregunta que haga, en orden. No dejes ninguna sin responder.
- Preguntas sobre el negocio (precios, plazos, pagos, horarios, ubicación, garantías, cómo trabajamos): responde con los datos de abajo.
- Preguntas generales (cómo hacer un buen CV, qué poner en una carta, una duda de ortografía, una traducción corta, un consejo): ayúdale de verdad con una respuesta útil y concreta. Si encaja, menciona después que también podemos hacerlo por él, sin presionar.
- Si preguntan algo del negocio que no está en los datos de abajo, no lo inventes: di con naturalidad que lo confirmas con el equipo y llama a avisar_al_dueno. Sigue ayudando con lo demás.
- Si el cliente manda una imagen, mírala y responde sobre lo que ves (por ejemplo una captura de pago, un documento o un ejemplo de lo que quiere).
- Si manda un audio, no puedes escucharlo: pídele con amabilidad que te lo escriba (solo la primera vez; si insiste con audios, usa pasar_a_humano).

# Nunca seas repetitiva
- Revisa la conversación antes de escribir. No repitas lo que ya dijiste: ni el saludo, ni la presentación, ni la lista de servicios, ni precios que ya diste, salvo que el cliente lo pida otra vez. Si lo pide de nuevo, dilo con otras palabras y más corto.
- Saluda solo al inicio de la conversación (o si el cliente vuelve después de muchas horas). En los demás mensajes ve directo al punto.
- No termines todos los mensajes con la misma pregunta o la misma frase ("¿En qué más te puedo ayudar?", "¡Quedo atenta!"). Varía, y muchas veces no hace falta cerrar con nada.
- Responde a lo que el cliente dijo en su último mensaje. Si solo dice "ok", "gracias" o manda un emoji, contesta breve y natural, sin repetir información.

# Estilo WhatsApp
- Mensajes cortos: normalmente 1 a 4 líneas. Solo alarga si el cliente pidió una explicación o una lista.
- Español sencillo y cálido, tuteando salvo que el cliente use "usted". Imita su nivel de formalidad.
- *Negritas* de WhatsApp solo para precios o datos clave. Como mucho 1 emoji, y no en todos los mensajes.
- Nunca digas que eres una IA salvo que te lo pregunten directamente; si te lo preguntan, sé honesta: eres la asistente virtual del negocio y un humano del equipo revisa los trabajos.

# Ventas y pedidos
1. Identifica qué necesita, cuántos y para cuándo. Da el precio total (precio × cantidad, con recargo si es urgente según las políticas) y el tiempo de entrega.
2. Pide los datos que el servicio necesita (campo "requisitos"), de uno o dos a la vez, no todos en un solo bloque.
3. Resume el pedido (servicio, detalles clave, precio, plazo) y pide confirmación.
4. Solo cuando el cliente confirme, llama a registrar_pedido con una descripción completa: quien haga el trabajo solo verá esa descripción.
5. ${REQUIERE_PAGO ? `Luego indica cómo pagar el adelanto (${c.datosPago}) y que envíe la captura. Cuando la envíe, llama a reportar_pago; el trabajo empieza cuando el equipo lo confirme.` : "Luego dile que ya empezamos y que le avisaremos al terminar."}
- Precios: usa solo los del catálogo. Descuentos, volumen grande o trabajos que no estén en el catálogo: avisar_al_dueno y dile que le confirmas el precio.
- Más datos para un pedido ya registrado: agregar_info_pedido. Preguntas por el avance: consultar_pedidos. Cambios a un trabajo entregado: solicitar_correccion.
- Si el cliente pide hablar con una persona, está molesto, reclama o hay un problema con un pago: pasar_a_humano.

# Datos del negocio (única fuente de verdad)
${JSON.stringify(c, null, 2)}`;
}

const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const tools = [
  {
    name: "registrar_pedido",
    description: "Registra un pedido confirmado por el cliente. Llamar solo después de que el cliente aceptó precio y plazo.",
    strict: true,
    input_schema: obj({
      servicio_id: { type: "string", description: "id del servicio en el catálogo" },
      servicio_nombre: { type: "string" },
      cantidad: { type: "number" },
      precio_total: { type: "number", description: "Precio total acordado" },
      urgente: { type: "boolean" },
      plazo: { type: "string", description: "Plazo acordado, p. ej. '24 horas' o 'viernes 20'" },
      descripcion: {
        type: "string",
        description: "Instrucciones completas para hacer el trabajo: todos los datos del cliente, tono, extensión, idioma y formato.",
      },
    }),
  },
  {
    name: "reportar_pago",
    description: "El cliente envió la captura o el aviso de que pagó. Avisa al dueño para que lo confirme.",
    strict: true,
    input_schema: obj({
      pedido_id: { type: "string" },
      monto: { type: "number", description: "Monto que se ve en la captura, o 0 si no se ve" },
      detalle: { type: "string", description: "Qué se ve en la captura (método, fecha, nombre, número de operación)" },
    }),
  },
  {
    name: "agregar_info_pedido",
    description: "Agrega datos que el cliente envía para un pedido existente que aún no se entregó.",
    strict: true,
    input_schema: obj({ pedido_id: { type: "string" }, info: { type: "string" } }),
  },
  {
    name: "consultar_pedidos",
    description: "Devuelve los pedidos de este cliente con su estado actual.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "solicitar_correccion",
    description: "Reabre un pedido entregado para hacer las correcciones que pide el cliente.",
    strict: true,
    input_schema: obj({ pedido_id: { type: "string" }, cambios: { type: "string" } }),
  },
  {
    name: "avisar_al_dueno",
    description:
      "Envía una consulta al dueño sin detener la conversación: datos del negocio que no conoces, precios especiales o algo que requiera su decisión.",
    strict: true,
    input_schema: obj({ consulta: { type: "string" } }),
  },
  {
    name: "pasar_a_humano",
    description: "Transfiere el chat al dueño. El bot deja de responder aquí hasta que el dueño lo reactive.",
    strict: true,
    input_schema: obj({ motivo: { type: "string" } }),
  },
];

const ESTADOS = {
  pendiente_pago: "esperando confirmación del pago",
  en_cola: "en cola para empezar",
  en_progreso: "en elaboración",
  en_revision: "en revisión final",
  entregado: "entregado",
  cancelado: "cancelado",
  error: "en elaboración",
};

async function ejecutarHerramienta(nombre, input, telefono) {
  const chat = db.getChat(telefono);
  const quien = chat.nombre || "+" + chat.numero;
  const propio = (id) => {
    const p = db.getPedido(String(id).trim().toUpperCase());
    return p && p.telefono === telefono ? p : null;
  };
  switch (nombre) {
    case "registrar_pedido": {
      const p = db.crearPedido({
        ...input,
        telefono,
        numero: chat.numero,
        cliente: chat.nombre,
        estado: REQUIERE_PAGO ? "pendiente_pago" : "en_cola",
      });
      await notificarDueno(`🆕 Pedido ${p.id} de ${quien}: ${p.servicio_nombre} x${p.cantidad} — ${catalogo().moneda}${p.precio_total} (${p.plazo})`);
      return { ok: true, pedido_id: p.id, estado: ESTADOS[p.estado] };
    }
    case "reportar_pago": {
      const p = propio(input.pedido_id) || db.listPedidos({ telefono, estado: "pendiente_pago" })[0];
      if (!p) return { ok: false, error: "No hay un pedido pendiente de pago para este cliente" };
      db.updatePedido(p.id, { pagoReportado: { monto: input.monto, detalle: input.detalle, fecha: new Date().toISOString() } });
      await notificarDueno(`💰 ${quien} dice que pagó ${catalogo().moneda}${input.monto} del pedido ${p.id}: ${input.detalle}. Confírmalo en el panel.`);
      return { ok: true, pedido_id: p.id, nota: "Dile que el equipo verifica el pago en breve y entonces empieza el trabajo." };
    }
    case "agregar_info_pedido": {
      const p = propio(input.pedido_id);
      if (!p) return { ok: false, error: "No existe ese pedido para este cliente" };
      if (p.estado === "entregado") return { ok: false, error: "Ya fue entregado; usa solicitar_correccion" };
      db.updatePedido(p.id, { descripcion: p.descripcion + "\n\nDatos adicionales del cliente: " + input.info });
      return { ok: true };
    }
    case "consultar_pedidos":
      return db
        .listPedidos({ telefono })
        .slice(0, 10)
        .map((p) => ({ id: p.id, servicio: p.servicio_nombre, estado: ESTADOS[p.estado], plazo: p.plazo, creado: p.creado, pago_reportado: !!p.pagoReportado }));
    case "solicitar_correccion": {
      const p = propio(input.pedido_id);
      if (!p) return { ok: false, error: "No existe ese pedido para este cliente" };
      db.updatePedido(p.id, { estado: "en_cola", notasRevision: input.cambios });
      await notificarDueno(`✏️ Corrección pedida en ${p.id}: ${input.cambios}`);
      return { ok: true, estado: "en cola para corregir" };
    }
    case "avisar_al_dueno":
      await notificarDueno(`❓ Consulta de ${quien}: ${input.consulta}`);
      return { ok: true, nota: "Consulta enviada. Dile que se lo confirmas pronto y continúa con lo demás." };
    case "pasar_a_humano":
      chat.botActivo = false;
      chat.pausaHasta = null;
      db.save();
      await notificarDueno(`🙋 ${quien} necesita atención humana: ${input.motivo}`);
      return { ok: true, nota: "Avísale que una persona del equipo le escribe en breve." };
    default:
      return { ok: false, error: "Herramienta desconocida" };
  }
}

const hora = (iso) =>
  new Date(iso).toLocaleString("es-PE", { timeZone: process.env.TZ || "America/Lima", dateStyle: "short", timeStyle: "short" });

// Convierte el historial guardado en mensajes para Claude. Incluye la hora de cada
// mensaje (para saber si el cliente volvió después de mucho tiempo) y las imágenes recientes.
function historial(chat) {
  const recientes = chat.mensajes.slice(-60);
  const conImagen = new Set(recientes.filter((m) => m.imagen).slice(-4)); // máximo 4 imágenes
  const msgs = [];
  for (const m of recientes) {
    const role = m.rol === "cliente" ? "user" : "assistant";
    const bloques = [];
    if (role === "user" && conImagen.has(m)) {
      const data = db.leerImagen(m.imagen);
      if (data) bloques.push({ type: "image", source: { type: "base64", media_type: m.imagen.media_type, data } });
    }
    const etiqueta = role === "user" ? `[${hora(m.fecha)}] ` : m.rol === "humano" ? "(escrito por el dueño) " : "";
    const texto = (m.texto || (m.imagen ? "[imagen]" : "")).trim();
    if (texto) bloques.push({ type: "text", text: role === "user" ? etiqueta + texto : etiqueta + texto });
    if (!bloques.length) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content.push(...bloques);
    else msgs.push({ role, content: bloques });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

// ---------- Detector de respuestas repetidas ----------
const normalizar = (t) =>
  t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ").split(/\s+/).filter((w) => w.length > 2);

export function similitud(a, b) {
  const A = new Set(normalizar(a));
  const B = new Set(normalizar(b));
  if (!A.size || !B.size) return a.trim() === b.trim() ? 1 : 0;
  let comun = 0;
  for (const w of A) if (B.has(w)) comun++;
  return comun / Math.min(A.size, B.size);
}

function esRepetida(texto, chat) {
  const anteriores = chat.mensajes.filter((m) => m.rol === "bot").slice(-6).map((m) => m.texto);
  return anteriores.find((t) => normalizar(texto).length >= 4 && similitud(texto, t) >= 0.8) || null;
}

// Genera la respuesta para los últimos mensajes del cliente.
export async function responder(telefono) {
  const chat = db.getChat(telefono);
  const messages = historial(chat);
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;

  const system = [
    { type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } },
    { type: "text", text: `Ahora: ${hora(new Date().toISOString())}. Cliente: ${chat.nombre || "sin nombre"} (+${chat.numero}).` },
  ];

  let reintentoAntirepeticion = false;
  for (let i = 0; i < 8; i++) {
    const response = await crear({
      max_tokens: 8000,
      output_config: { effort: ESFUERZO },
      system,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return "Disculpa, con eso no puedo ayudarte por aquí. Si quieres, le paso tu consulta a una persona del equipo.";
    }

    if (response.stop_reason !== "tool_use") {
      const texto = textoDe(response);
      if (!texto) return null;
      const parecida = esRepetida(texto, chat);
      if (parecida && !reintentoAntirepeticion) {
        // Pide una versión distinta sin tocar el historial (mensaje de sistema al final).
        reintentoAntirepeticion = true;
        messages.push({
          role: "system",
          content: `Tu respuesta iba a ser casi igual a un mensaje que ya enviaste antes en este chat:\n«${parecida}»\nNo lo repitas. Responde a lo que el cliente acaba de decir con otras palabras, más breve, aportando solo lo nuevo. Si no hay nada nuevo que decir, una frase corta y natural basta.`,
        });
        continue;
      }
      return texto;
    }

    messages.push({ role: "assistant", content: response.content });
    const resultados = [];
    for (const b of response.content) {
      if (b.type !== "tool_use") continue;
      let out;
      try {
        out = await ejecutarHerramienta(b.name, b.input, telefono);
      } catch (e) {
        out = { ok: false, error: e.message };
      }
      resultados.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: resultados });
  }
  return "Dame un momento, estoy revisando tu pedido. 🙏";
}
