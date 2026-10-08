// Spanish copy of Ajustes → Avisos and its actions (SPEC-reminders "Pantallas"). Client-safe.
// Calm, no guilt, no jargon: the owner connects a bot, nothing more.

export const TELEGRAM_NOT_CONFIGURED_MESSAGE =
  "El bot todavía no está configurado en el servidor. Faltan variables de entorno.";
export const TELEGRAM_ALREADY_CONNECTED_MESSAGE =
  "Telegram ya está conectado. Desconéctalo primero para vincular otro chat.";
export const TELEGRAM_WEBHOOK_FAILED_MESSAGE =
  "Telegram no aceptó el registro del bot. Revisa el token e inténtalo de nuevo.";

export const TELEGRAM_CONNECT_STEPS =
  "Abre el enlace en Telegram y toca «Iniciar». El enlace sirve una vez y caduca en 10 minutos.";
export const TELEGRAM_CONNECTED_MESSAGE = "Telegram quedó conectado.";
export const TELEGRAM_DISCONNECTED_MESSAGE = "Telegram quedó desconectado.";

export const REMINDERS_SOON_MESSAGE =
  "Aquí podrás elegir qué avisos recibir y a qué hora. Todavía no hay avisos activos.";

export function telegramStateText(
  state: "disconnected" | "connected" | "blocked",
  linkedLabel: string | null,
): string {
  if (state === "connected") {
    return linkedLabel ? `Conectado desde el ${linkedLabel}.` : "Conectado.";
  }
  if (state === "blocked") {
    return "Telegram bloqueó el envío (¿bloqueaste el bot?). Desbloquéalo en Telegram y vuelve a conectar.";
  }
  return "Sin conectar.";
}
