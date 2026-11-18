// Acceso a Claude (API de Anthropic) con respaldo automático si el modelo declina.
import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// Parámetros comunes: "fallbacks: default" reintenta en otro modelo si el
// principal se niega por una política de seguridad (beta server-side fallback).
function base(params) {
  return {
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...params,
  };
}

export async function crear(params) {
  return client.beta.messages.create(base(params));
}

// Para trabajos largos usamos streaming (evita timeouts HTTP) y esperamos el mensaje final.
export async function crearLargo(params) {
  return client.beta.messages.stream(base(params)).finalMessage();
}

export function textoDe(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
