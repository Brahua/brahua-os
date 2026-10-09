import type { MetadataRoute } from "next";
import { brandHex } from "@/design-system/brand-colors";
import { APP_DESCRIPTION, APP_NAME, MANIFEST_ICONS } from "@/lib/pwa";

/**
 * SPEC-core "PWA": installable, standalone. The only service worker is push-only (public/sw.js,
 * `reminders`), registered from Ajustes → Avisos; it has no fetch handler, so it caches nothing.
 * Served at /manifest.webmanifest without a session: it sits outside (app), whose layout is the
 * only thing that asks for one.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "es",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Dark is the default theme: the splash screen and the title bar match the first paint.
    background_color: brandHex("darkBackground"),
    theme_color: brandHex("darkBackground"),
    icons: MANIFEST_ICONS.map(({ src, size, purpose }) => ({
      src,
      sizes: `${size}x${size}`,
      type: "image/png",
      purpose,
    })),
  };
}
