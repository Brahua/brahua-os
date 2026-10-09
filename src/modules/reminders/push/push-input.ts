// Validation of what the browser sends when it subscribes to push (SPEC-reminders "Push web").
// Client-safe: the screen builds the same shape the Server Action then validates.
//
// The endpoint is a URL the SERVER will POST to, so it is held to a short list of the real push
// services (a forged one must never make the server call an arbitrary host). The channel itself
// sends to whatever is stored; the allowlist is enforced where it is written, here.
import { z } from "zod";
import { PUSH_ENDPOINT_MAX_LENGTH } from "../reminders-constants";

export const PUSH_ERRORS = {
  endpoint: "Este navegador usa un servicio de push que no está permitido.",
  keys: "La suscripción del navegador no es válida.",
} as const;

/** Hosts that are exactly this. */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
/** Hosts under these (`*.push.apple.com`, Edge's `*.notify.windows.com`, Firefox's regional ones). */
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

/** Whether `endpoint` is an https URL, with no credentials or port, on a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const endpoint = z
  .string({ error: PUSH_ERRORS.endpoint })
  .refine(isAllowedPushEndpoint, { error: PUSH_ERRORS.endpoint });

/** `PushSubscription.toJSON().keys`: base64url, no padding (65-byte P-256 point and 16-byte secret). */
const p256dh = z.string({ error: PUSH_ERRORS.keys }).regex(/^[A-Za-z0-9_-]{87}$/, PUSH_ERRORS.keys);
const auth = z.string({ error: PUSH_ERRORS.keys }).regex(/^[A-Za-z0-9_-]{22}$/, PUSH_ERRORS.keys);

/** Strict: an unknown key is rejected, not ignored. */
export const pushSubscriptionSchema = z.strictObject({
  endpoint,
  keys: z.strictObject({ p256dh, auth }),
});
export type PushSubscriptionInput = z.output<typeof pushSubscriptionSchema>;

/** Which device: the browser's own endpoint (it identifies the subscription). */
export const pushEndpointSchema = z.strictObject({ endpoint });
export type PushEndpointInput = z.output<typeof pushEndpointSchema>;
