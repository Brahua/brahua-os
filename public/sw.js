// brahua-os service worker: push only (SPEC-reminders "Push web").
//
// It does two things, `push` (show the notification) and `notificationclick` (open the app), and
// nothing else. There is NO `fetch` handler and no cache on purpose: a worker that cached pages
// would serve old HTML after a deploy. Without a fetch handler the browser goes straight to the
// network for every request.
//
// Served from /sw.js with `Cache-Control: no-cache` (next.config.ts) and registered with scope "/"
// from Ajustes → Avisos, not on every page load.

self.addEventListener("install", () => {
  // A new version replaces the old one at once: there is no cache to migrate.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** `value` if it is a non-empty string, cut to `max`; otherwise `fallback`. */
function text(value, max, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.slice(0, max) : fallback;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (data === null || typeof data !== "object") data = {};

  // Every push must show a notification (iOS revokes the permission of a site that doesn't), so a
  // payload we cannot read still shows the title.
  const title = text(data.title, 80, "brahua-os");
  const options = {
    body: text(data.body, 400, ""),
    // The same tag replaces the notification instead of stacking another one.
    tag: text(data.tag, 200, undefined),
    icon: "/icons/icon-192.png",
    lang: "es",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The app is already open somewhere: bring it forward instead of opening a second one.
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })(),
  );
});
