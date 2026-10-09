// Spanish copy of Ajustes → Avisos → "Canal de avisos" and the push device (R5). Client-safe.
// Calm and concrete: it says what will happen, and what to do when push cannot work.

export const CHANNEL_COPY = {
  title: "Canal de avisos",
  intro:
    "Elige por dónde te llegan los avisos. La captura por texto sigue siendo del bot de Telegram.",
  groupLabel: "Canal de avisos",
  options: { push: "Push", telegram: "Telegram", both: "Ambos" },
  saved: "Guardado.",
  saveFailed: "No se pudo guardar. Inténtalo de nuevo.",
  device: {
    title: "Este dispositivo",
    checking: "Revisando este dispositivo…",
    on: "Este dispositivo recibe avisos por push.",
    off: "Este dispositivo no recibe avisos por push.",
    denied:
      "El permiso de notificaciones está bloqueado. Actívalo para brahua-os en los ajustes del sistema o del navegador y vuelve aquí.",
    needsInstall:
      "En iPhone y iPad el push solo funciona con la app instalada. Toca Compartir, elige «Añadir a pantalla de inicio», abre brahua-os desde el ícono nuevo y vuelve a esta pantalla.",
    unsupported:
      "Este navegador no permite avisos por push. Prueba con la app instalada o con otro navegador.",
    notConfigured: "El push todavía no está configurado en el servidor.",
    activate: "Activar este dispositivo",
    activating: "Activando…",
    deactivate: "Desactivar este dispositivo",
    deactivating: "Desactivando…",
    activated: "Este dispositivo quedó activado.",
    deactivated: "Este dispositivo quedó desactivado.",
    activateFailed: "No se pudo activar este dispositivo. Inténtalo de nuevo.",
    deactivateFailed: "No se pudo desactivar este dispositivo. Inténtalo de nuevo.",
    tooMany: "Ya hay 10 dispositivos activos. Desactiva alguno antes de sumar otro.",
    listLabel: "Dispositivos con push",
  },
} as const;

/** What the owner will actually get, in words (the fallback to Telegram included). */
export function channelNote(input: {
  deliveryChannel: "push" | "telegram" | "both";
  /** The channels that will send now (`selectChannels`). */
  effective: readonly ("push" | "telegram")[];
  devices: number;
}): string {
  const { deliveryChannel, effective, devices } = input;
  const push = effective.includes("push");
  const telegram = effective.includes("telegram");
  const devicesText = devices === 1 ? "1 dispositivo" : `${devices} dispositivos`;
  if (push && telegram) return `Los avisos llegan por push (${devicesText}) y por Telegram.`;
  if (push) {
    return deliveryChannel === "both"
      ? `Los avisos llegan por push (${devicesText}). Conecta Telegram para recibirlos también ahí.`
      : `Los avisos llegan por push (${devicesText}).`;
  }
  if (telegram) {
    if (deliveryChannel === "telegram") return "Los avisos llegan por Telegram.";
    return "Todavía no hay un dispositivo con push: mientras tanto los avisos llegan por Telegram.";
  }
  if (deliveryChannel === "telegram") {
    return "Telegram no está conectado, así que ahora no se envía ningún aviso.";
  }
  return "Ahora mismo no hay ningún canal listo, así que no se envía ningún aviso. Activa este dispositivo o conecta Telegram.";
}
