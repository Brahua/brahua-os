import { describe, expect, test } from "vitest";
import {
  PASSKEY_ALREADY_REGISTERED_MESSAGE,
  PASSKEY_DELETE_FAILED_MESSAGE,
  PASSKEY_GENERIC_MESSAGE,
  PASSKEY_RATE_LIMIT_MESSAGE,
  PASSKEY_REGISTER_FAILED_MESSAGE,
  PASSKEY_SESSION_EXPIRED_MESSAGE,
  PASSKEY_SESSION_NOT_FRESH_MESSAGE,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  passkeyDeleteErrorMessage,
  passkeyRegisterErrorMessage,
  passkeySignInErrorMessage,
} from "@/lib/passkey-messages";

// Only these mean "the person closed the prompt" (or a newer request replaced it).
const CANCELLED = [
  { status: 400, code: "ERROR_CEREMONY_ABORTED" },
  { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }, // NotAllowedError
];

describe("passkeySignInErrorMessage", () => {
  test("closing the browser prompt says nothing", () => {
    for (const error of CANCELLED) expect(passkeySignInErrorMessage(error)).toBeNull();
  });

  test("Better Auth's AUTH_CANCELLED is not a cancel: its client also uses it for network errors", () => {
    expect(passkeySignInErrorMessage({ status: 400, code: "AUTH_CANCELLED" })).toBe(
      PASSKEY_GENERIC_MESSAGE,
    );
  });

  test("a rejected passkey (unknown, bad signature, not the owner's) gets one calm message", () => {
    for (const error of [
      { status: 401, code: "PASSKEY_NOT_FOUND" },
      { status: 401, code: "AUTHENTICATION_FAILED" },
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
    for (const error of [
      { status: 500 },
      { status: 403 },
      { code: "NETWORK_ERROR" },
      {},
      null,
      undefined,
    ]) {
      expect(passkeySignInErrorMessage(error)).toBe(PASSKEY_GENERIC_MESSAGE);
    }
  });
});

describe("passkeyRegisterErrorMessage", () => {
  test("closing the browser prompt says nothing", () => {
    for (const error of CANCELLED) expect(passkeyRegisterErrorMessage(error)).toBeNull();
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

  test("only SESSION_NOT_FRESH is a stale session; other 403s are generic", () => {
    expect(passkeyRegisterErrorMessage({ status: 403 })).toBe(PASSKEY_REGISTER_FAILED_MESSAGE);
    expect(passkeyRegisterErrorMessage({ status: 403, code: "INVALID_ORIGIN" })).toBe(
      PASSKEY_REGISTER_FAILED_MESSAGE,
    );
  });
});

describe("passkeyDeleteErrorMessage", () => {
  test("session problems are explained, anything else is generic", () => {
    expect(passkeyDeleteErrorMessage({ status: 403, code: "SESSION_NOT_FRESH" })).toBe(
      PASSKEY_SESSION_NOT_FRESH_MESSAGE,
    );
    expect(passkeyDeleteErrorMessage({ status: 401 })).toBe(PASSKEY_SESSION_EXPIRED_MESSAGE);
    expect(passkeyDeleteErrorMessage({ status: 403 })).toBe(PASSKEY_DELETE_FAILED_MESSAGE);
    expect(passkeyDeleteErrorMessage(null)).toBe(PASSKEY_DELETE_FAILED_MESSAGE);
  });
});
