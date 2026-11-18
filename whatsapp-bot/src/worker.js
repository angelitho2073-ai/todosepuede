// Trabajador: toma pedidos "en_cola", Claude hace el trabajo, luego lo revisa en
// tono natural y lo deja "en_revision" para que el dueño apruebe y se entregue.
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { crearLargo, textoDe } from "./claude.js";
import * as db from "./db.js";
import { enviarTexto, enviarDocumento } from "./whatsapp.js";
import { notificarDueno } from "./notify.js";
import { catalogo } from "./agent.js";

const AUTO_ENTREGA = process.env.AUTO_ENTREGA === "true";

const SYSTEM_PRODUCCION = `Eres el equipo de producción de un negocio de servicios. Recibes un pedido de un cliente y entregas el trabajo terminado, listo para usar.
- Cumple exactamente lo pedido: datos, extensión, idioma, tono y formato.
- Si falta algún dato, usa un marcador claro entre corchetes, por ejemplo [COMPLETAR: teléfono], en lugar de inventarlo.
- Devuelve solo el contenido del entregable, sin comentarios sobre ti ni explicaciones previas.
- Usa títulos con "# " y "## " y listas con "- " cuando el formato lo requiera.`;

const SYSTEM_REVISION = `Eres el editor final del equipo. Recibes un trabajo ya hecho y lo dejas listo para el cliente:
- Corrige ortografía, gramática y coherencia.
- Haz que suene natural y cercano, como lo escribiría una persona del equipo con experiencia: varía la longitud de las frases, evita muletillas repetitivas, frases de relleno y fórmulas genéricas.
- Conserva todos los datos, la estructura y los marcadores [COMPLETAR: ...].
- Devuelve solo el texto final, sin comentarios.`;

async function producir(p) {
  const correccion = p.notasRevision
    ? `\n\nEste pedido vuelve por correcciones. Versión anterior entregada:\n<anterior>\n${p.final || p.borrador}\n</anterior>\nCambios pedidos: ${p.notasRevision}\nAplica los cambios y entrega la versión completa corregida.`
    : "";
  const r1 = await crearLargo({
    max_tokens: 64000,
    output_config: { effort: "high" },
    system: SYSTEM_PRODUCCION,
    messages: [
      {
        role: "user",
        content: `Servicio: ${p.servicio_nombre} (cantidad: ${p.cantidad})\nPlazo: ${p.plazo}\n\nInstrucciones del pedido:\n${p.descripcion}${correccion}`,
      },
    ],
  });
  if (r1.stop_reason === "refusal") throw new Error("El modelo no pudo realizar este pedido (rechazo de contenido).");
  const borrador = textoDe(r1);

  const r2 = await crearLargo({
    max_tokens: 64000,
    output_config: { effort: "medium" },
    system: SYSTEM_REVISION,
    messages: [{ role: "user", content: `Pedido: ${p.servicio_nombre}\n\n<trabajo>\n${borrador}\n</trabajo>` }],
  });
  const final = r2.stop_reason === "refusal" ? borrador : textoDe(r2) || borrador;
  return { borrador, final };
}

async function aDocx(texto, titulo) {
  const children = texto.split("\n").map((linea) => {
    if (linea.startsWith("# ")) return new Paragraph({ text: linea.slice(2), heading: HeadingLevel.HEADING_1 });
    if (linea.startsWith("## ")) return new Paragraph({ text: linea.slice(3), heading: HeadingLevel.HEADING_2 });
    if (linea.startsWith("- ")) return new Paragraph({ text: linea.slice(2), bullet: { level: 0 } });
    // **negrita** simple
    const runs = linea.split(/(\*\*[^*]+\*\*)/).map((t) =>
      t.startsWith("**") && t.endsWith("**") ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun(t)
    );
    return new Paragraph({ children: runs });
  });
  const doc = new Document({ title: titulo, sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// Entrega el trabajo al cliente por WhatsApp. formato: "auto" | "texto" | "docx"
export async function entregar(id, formato = "auto") {
  const p = db.getPedido(id);
  if (!p) throw new Error("Pedido no encontrado");
  const texto = p.final || p.borrador;
  if (!texto) throw new Error("El pedido no tiene contenido para entregar");
  const usarDocx = formato === "docx" || (formato === "auto" && texto.length > 2500);

  const saludo = `¡Hola${p.cliente ? " " + p.cliente.split(" ")[0] : ""}! Tu pedido *${p.servicio_nombre}* (${p.id}) ya está listo.`;
  if (usarDocx) {
    const buf = await aDocx(texto, p.servicio_nombre);
    await enviarTexto(p.telefono, saludo + " Te lo envío en documento Word 👇");
    await enviarDocumento(
      p.telefono,
      buf,
      `${p.servicio_nombre.replace(/[^\w áéíóúñÁÉÍÓÚÑ-]/g, "").slice(0, 40)} - ${p.id}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      p.servicio_nombre
    );
  } else {
    await enviarTexto(p.telefono, saludo);
    await enviarTexto(p.telefono, texto);
  }
  const { moneda } = catalogo();
  await enviarTexto(
    p.telefono,
    `Si quieres algún cambio, respóndeme aquí y lo ajustamos (incluye 1 corrección sin costo).${p.saldoPendiente ? ` Saldo pendiente: *${moneda}${p.saldoPendiente}*.` : ""} ¡Gracias por confiar en nosotros!`
  );
  db.addMensaje(p.telefono, "bot", `[Entregado el pedido ${p.id}]`);
  return db.updatePedido(id, { estado: "entregado", entregado: new Date().toISOString(), notasRevision: "" });
}

let ocupado = false;
async function ciclo() {
  if (ocupado) return;
  const p = db.listPedidos({ estado: "en_cola" }).at(-1); // el más antiguo primero
  if (!p) return;
  ocupado = true;
  db.updatePedido(p.id, { estado: "en_progreso", error: "" });
  try {
    const { borrador, final } = await producir(p);
    db.updatePedido(p.id, { borrador, final, estado: "en_revision" });
    if (AUTO_ENTREGA) {
      await entregar(p.id);
      await notificarDueno(`✅ Pedido ${p.id} entregado automáticamente.`);
    } else {
      await notificarDueno(`📝 Pedido ${p.id} listo para tu revisión en el panel.`);
    }
  } catch (e) {
    console.error("Error en pedido", p.id, e);
    db.updatePedido(p.id, { estado: "error", error: e.message });
    await notificarDueno(`⚠️ Error en pedido ${p.id}: ${e.message}`);
  } finally {
    ocupado = false;
  }
}

export function iniciarWorker() {
  setInterval(() => ciclo().catch(console.error), 10_000);
}
