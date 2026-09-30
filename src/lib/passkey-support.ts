// Browser capability checks for passkeys (client components only).
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Whether this browser can use passkeys: `null` while rendering on the server and hydrating
 * (it cannot know), then `true` or `false`. Never changes afterwards.
 */
export function usePasskeySupport(): boolean | null {
  return useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => null);
}
