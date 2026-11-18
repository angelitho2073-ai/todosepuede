// Agente que atiende a los clientes por WhatsApp: responde, cotiza y registra pedidos.
import fs from "fs";
import { crear, textoDe } from "./claude.js";
import * as db from "./db.js";
import { notificarDueno } from "./notify.js";

const CATALOGO_PATH = process.env.CATALOGO_PATH || "./catalogo.json";
export const catalogo = () => JSON.parse(fs.readFileSync(CATALOGO_PATH, "utf8"));

const REQUIERE_PAGO = (process.env.REQUIERE_PAGO ?? "true") === "true";

function systemPrompt() {
  const c = catalogo();
  return `Eres el asistente de atención por WhatsApp de "${c.negocio}". Atiendes a clientes reales: saludas con calidez, entiendes lo que necesitan, les das precios del catálogo y, cuando aceptan, registras su pedido.

Cómo escribir:
- Estás en WhatsApp: mensajes cortos (2 a 5 líneas), cercanos y en español sencillo. Usa *negritas* de WhatsApp solo para precios o datos clave. Máximo 1 emoji por mensaje.
- Haz una sola pregunta a la vez cuando falten datos.
- Nunca inventes servicios ni precios que no estén en el catálogo. Si piden algo fuera del catálogo o con condiciones especiales (descuentos, volumen grande, algo que no sabes cotizar), usa pasar_a_humano.
- Si el cliente pide hablar con una persona, está molesto o reclama un pago, usa pasar_a_humano.

Flujo de venta:
1. Identifica el servicio y la cantidad. Da el precio total (precio × cantidad, +30% si es urgente según políticas) y el tiempo de entrega.
2. Pide los datos que el servicio necesita (campo "requisitos"). Reúne todo lo necesario para que el trabajo se pueda hacer sin volver a preguntar.
3. Resume el pedido (servicio, detalles, precio, plazo) y pide confirmación explícita.
4. Solo cuando el cliente confirme, llama a registrar_pedido con una descripción completa y autosuficiente: quien haga el trabajo solo verá esa descripción.
5. ${REQUIERE_PAGO ? `Después de registrar, indica cómo pagar el adelanto (${c.datosPago}) y que envíe la captura del pago; el trabajo empieza cuando el equipo confirme el pago.` : "Después de registrar, dile que ya empezamos y que le avisaremos al terminar."}
- Si el cliente envía más datos de un pedido ya registrado, usa agregar_info_pedido.
- Si pregunta por el avance, usa consultar_pedidos.
- Si pide cambios a un trabajo entregado, usa solicitar_correccion.

Catálogo (fuente única de precios):
${JSON.stringify(c, null, 2)}`;
}

const tools = [
  {
    name: "registrar_pedido",
    description:
      "Registra un pedido confirmado por el cliente. Llamar solo después de que el cliente aceptó precio y plazo.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        servicio_id: { type: "string", description: "id del servicio en el catálogo" },
        servicio_nombre: { type: "string" },
        cantidad: { type: "number" },
        precio_total: { type: "number", description: "Precio total acordado en la moneda del catálogo" },
        urgente: { type: "boolean" },
        plazo: { type: "string", description: "Plazo de entrega acordado, p. ej. '24 horas' o 'viernes 20'" },
        descripcion: {
          type: "string",
          description:
            "Instrucciones completas para realizar el trabajo: todos los datos que dio el cliente, tono, extensión, idioma y formato.",
        },
      },
      required: ["servicio_id", "servicio_nombre", "cantidad", "precio_total", "urgente", "plazo", "descripcion"],
    },
  },
  {
    name: "agregar_info_pedido",
    description: "Agrega datos o archivos descritos por el cliente a un pedido existente que aún no se entregó.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { pedido_id: { type: "string" }, info: { type: "string" } },
      required: ["pedido_id", "info"],
    },
  },
  {
    name: "consultar_pedidos",
    description: "Devuelve los pedidos de este cliente con su estado actual.",
    strict: true,
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "solicitar_correccion",
    description: "Reabre un pedido entregado para hacer las correcciones que pide el cliente.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { pedido_id: { type: "string" }, cambios: { type: "string" } },
      required: ["pedido_id", "cambios"],
    },
  },
  {
    name: "pasar_a_humano",
    description:
      "Transfiere la conversación al dueño del negocio. El bot deja de responder en este chat hasta que el dueño lo reactive.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { motivo: { type: "string" } },
      required: ["motivo"],
    },
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
  const propio = (id) => {
    const p = db.getPedido(id);
    return p && p.telefono === telefono ? p : null;
  };
  switch (nombre) {
    case "registrar_pedido": {
      const p = db.crearPedido({
        ...input,
        telefono,
        cliente: chat.nombre,
        estado: REQUIERE_PAGO ? "pendiente_pago" : "en_cola",
      });
      await notificarDueno(
        `🆕 Pedido ${p.id} de ${chat.nombre || telefono}: ${p.servicio_nombre} x${p.cantidad} — ${catalogo().moneda}${p.precio_total} (${p.plazo})`
      );
      return { ok: true, pedido_id: p.id, estado: ESTADOS[p.estado] };
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
        .map((p) => ({ id: p.id, servicio: p.servicio_nombre, estado: ESTADOS[p.estado], plazo: p.plazo, creado: p.creado }));
    case "solicitar_correccion": {
      const p = propio(input.pedido_id);
      if (!p) return { ok: false, error: "No existe ese pedido para este cliente" };
      db.updatePedido(p.id, { estado: "en_cola", notasRevision: input.cambios });
      await notificarDueno(`✏️ Corrección pedida en ${p.id}: ${input.cambios}`);
      return { ok: true, estado: "en cola para corregir" };
    }
    case "pasar_a_humano":
      chat.botActivo = false;
      db.save();
      await notificarDueno(`🙋 ${chat.nombre || telefono} necesita atención humana: ${input.motivo}`);
      return { ok: true, nota: "Avísale al cliente que una persona del equipo le escribirá en breve." };
    default:
      return { ok: false, error: "Herramienta desconocida" };
  }
}

// Convierte el historial guardado en mensajes para Claude (solo texto, alternando roles).
function historial(chat) {
  const msgs = [];
  for (const m of chat.mensajes.slice(-40)) {
    const role = m.rol === "cliente" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content += "\n" + m.texto;
    else msgs.push({ role, content: m.texto });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

// Genera la respuesta del bot para el último mensaje del cliente.
export async function responder(telefono) {
  const chat = db.getChat(telefono);
  const messages = historial(chat);
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;

  const system = [
    { type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `Fecha y hora actual: ${new Date().toLocaleString("es-PE", { timeZone: process.env.TZ || "America/Lima" })}. Cliente: ${chat.nombre || "sin nombre"} (${telefono}).`,
    },
  ];

  for (let i = 0; i < 6; i++) {
    const response = await crear({
      max_tokens: 4000,
      output_config: { effort: "low" },
      system,
      tools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return "Disculpa, no puedo ayudarte con eso por este medio. Si quieres, te comunico con una persona del equipo.";
    }
    if (response.stop_reason !== "tool_use") return textoDe(response);

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
  return "Dame un momento, por favor, estoy revisando tu pedido. 🙏";
}
