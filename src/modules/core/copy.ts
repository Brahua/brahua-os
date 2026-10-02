// User-facing copy of the navigation shell (Spanish).
export const NAV_COPY = {
  mainNav: "Principal",
  footerNav: "Secundaria",
  brand: "brahua-os",
  capture: "Capturar",
  /** The capture key without a registered capture provider (src/lib/quick-capture.ts). */
  captureUnavailable: "Próximamente",
  collapseSidebar: "Contraer barra lateral",
  expandSidebar: "Expandir barra lateral",
  more: "Más",
  moreSections: "Más secciones",
  moreCurrent: (label: string) => `Más (actual: ${label})`,
  skipToContent: "Saltar al contenido",
} as const;

// Error pages (C8). Blame-free: nothing here says the owner did something wrong, and no
// technical detail (message, stack) is ever shown; only the opaque error code when there is one.
export const STATUS_COPY = {
  notFound: {
    title: "Página no encontrada · brahua-os",
    lcdTag: "404",
    lcd: "No encontramos esta página.",
    heading: "Nada por aquí",
    description:
      "Puede que la dirección haya cambiado o que la página ya no exista. Todo lo demás sigue en su lugar.",
  },
  error: {
    title: "Algo no salió bien · brahua-os",
    lcdTag: "Aviso",
    lcd: "No pudimos mostrar esta pantalla.",
    heading: "Algo no salió bien",
    description:
      "No es nada que hayas hecho y lo que ya guardaste sigue a salvo. Reintenta en un momento o vuelve a Hoy.",
    retry: "Reintentar",
    /** The digest only matches the server log entry; it says nothing about the error itself. */
    code: (digest: string) => `Código del error: ${digest}`,
  },
  backHome: "Volver a Hoy",
  signIn: "Ir a iniciar sesión",
} as const;
