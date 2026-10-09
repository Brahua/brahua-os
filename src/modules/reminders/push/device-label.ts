// A short name for a device out of its user agent, to list it in Ajustes ("iPhone · Safari").
// Pure and forgiving: an unknown agent is just "Dispositivo".

function systemOf(userAgent: string): string | null {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return null;
}

function browserOf(userAgent: string): string | null {
  // Order matters: Edge and Opera also say Chrome; every iOS browser also says Safari.
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Dispositivo";
  const parts = [systemOf(userAgent), browserOf(userAgent)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : "Dispositivo";
}
