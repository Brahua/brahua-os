import { describe, expect, test } from "vitest";
import {
  PASSKEY_ALREADY_REGISTERED_MESSAGE,
  PASSKEY_GENERIC_MESSAGE,
  PASSKEY_RATE_LIMIT_MESSAGE,
  PASSKEY_REGISTER_FAILED_MESSAGE,
  PASSKEY_SESSION_EXPIRED_MESSAGE,
  PASSKEY_SESSION_NOT_FRESH_MESSAGE,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  passkeyRegisterErrorMessage,
  passkeySignInErrorMessage,
} from "@/lib/passkey-messages";

// Error shapes returned by the Better Auth passkey client.
const CANCELLED = [
  { status: 400, code: "ERROR_CEREMONY_ABORTED" }, // replaced by another request
  { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }, // NotAllowedError: closed or timed out
  { status: 400, code: "AUTH_CANCELLED" },
];

describe("passkeySignInErrorMessage", () => {
  test("closing the browser prompt says nothing", () => {
    for (const error of CANCELLED) expect(passkeySignInErrorMessage(error)).toBeNull();
  });

  test("a rejected passkey (unknown, bad signature, not the owner's) gets one calm message", () => {
    for (const error of [
      { status: 401, code: "PASSKEY_NOT_FOUND" },
      { status: 400, code: "AUTHENTICATION_FAILED" },
      { status: 400, code: "CHALLENGE_NOT_FOUND" },
      { status: 500, code: "UNABLE_TO_CREATE_SESSION" },
      { status: 400, code: "ERROR_INVALID_RP_ID" },
    ]) {
      expect(passkeySignInErrorMessage(error)).toBe(PASSKEY_SIGN_IN_FAILED_MESSAGE);
    }
  });

  test("429 explains the rate limit; anything else is generic", () => {
    expect(passkeySignInErrorMessage({ status: 429 })).toBe(PASSKEY_RATE_LIMIT_MESSAGE);
    for (const error of [{ status: 500 }, { status: 403 }, {}, null, undefined]) {
      expect(passkeySignInErrorMessage(error)).toBe(PASSKEY_GENERIC_MESSAGE);
    }
  });
});

describe("passkeyRegisterErrorMessage", () => {
  test("closing the browser prompt says nothing", () => {
    for (const error of CANCELLED.slice(0, 2)) {
      expect(passkeyRegisterErrorMessage(error)).toBeNull();
    }
  });

  test("explains each known failure", () => {
    expect(
      passkeyRegisterErrorMessage({
        status: 400,
        code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      }),
    ).toBe(PASSKEY_ALREADY_REGISTERED_MESSAGE);
    expect(passkeyRegisterErrorMessage({ status: 403, code: "SESSION_NOT_FRESH" })).toBe(
      PASSKEY_SESSION_NOT_FRESH_MESSAGE,
    );
    expect(passkeyRegisterErrorMessage({ status: 401 })).toBe(PASSKEY_SESSION_EXPIRED_MESSAGE);
    expect(passkeyRegisterErrorMessage({ status: 429 })).toBe(PASSKEY_RATE_LIMIT_MESSAGE);
    expect(passkeyRegisterErrorMessage({ status: 500, code: "UNKNOWN_ERROR" })).toBe(
      PASSKEY_REGISTER_FAILED_MESSAGE,
    );
  });
});
