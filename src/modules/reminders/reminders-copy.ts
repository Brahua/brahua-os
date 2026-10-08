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

// Avisos del día (R2): one switch per reminder, its time and the amounts switch.
export const SCHEDULE_COPY = {
  title: "Avisos del día",
  intro:
    "Elige qué avisos recibir y a qué hora. Si cambias una hora antes de que llegue, el aviso de hoy se mueve con ella.",
  briefing: {
    label: "Resumen de la mañana",
    help: "Tus hábitos, tareas y pagos de hoy en una línea. Un día sin nada no manda nada.",
    time: "Hora del resumen",
  },
  payments: {
    label: "Avisos de pagos",
    help: "Un día antes de que venza un pago y, si sigue pendiente, tres días después. Llegan a la hora del resumen.",
  },
  evening: {
    label: "Repaso de la noche",
    help: "Solo si te queda algún hábito de hoy por hacer.",
    time: "Hora del repaso",
  },
  amounts: {
    label: "Montos en Telegram",
    help: "Muestra cuánto es en el resumen y en los avisos de pagos.",
  },
  saved: "Guardado.",
  saveFailed: "No se pudo guardar. Inténtalo de nuevo.",
} as const;

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
