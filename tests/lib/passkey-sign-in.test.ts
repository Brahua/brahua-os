import { startAuthentication, WebAuthnError } from "@simplewebauthn/browser";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { signInWithPasskey } from "@/lib/passkey-sign-in";

vi.mock("@/lib/auth-client", () => ({ authClient: { $fetch: vi.fn() } }));
vi.mock("@simplewebauthn/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/browser")>()),
  startAuthentication: vi.fn(),
}));

const $fetch = vi.mocked(authClient.$fetch);
const start = vi.mocked(startAuthentication);

const OPTIONS = { challenge: "abc", rpId: "localhost", userVerification: "preferred" };
const CREDENTIAL = {
  id: "cred",
  rawId: "cred",
  type: "public-key",
  response: { clientDataJSON: "c", authenticatorData: "a", signature: "s" },
  clientExtensionResults: {},
  authenticatorAttachment: "platform",
};

beforeEach(() => {
  $fetch.mockReset();
  start.mockReset();
});

const current = () => true;

describe("signInWithPasskey", () => {
  test("asks the browser for a user-verified assertion and posts it without extensions", async () => {
    $fetch
      .mockResolvedValueOnce({ data: OPTIONS, error: null } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);
    start.mockResolvedValue(CREDENTIAL as never);
    const onVerifying = vi.fn();

    const result = await signInWithPasskey({ autofill: true, isCurrent: current, onVerifying });

    expect(result).toEqual({ outcome: "signed-in" });
    expect(start).toHaveBeenCalledWith({
      optionsJSON: { ...OPTIONS, userVerification: "required" },
      useBrowserAutofill: true,
    });
    expect(onVerifying).toHaveBeenCalled();
    const [, init] = $fetch.mock.calls[1];
    expect(init).toMatchObject({ method: "POST" });
    const body = (init as { body: { response: Record<string, unknown> } }).body;
    expect(body.response).not.toHaveProperty("clientExtensionResults");
    expect(body.response).toMatchObject({ id: "cred", type: "public-key" });
  });

  test("an attempt outdated while fetching options never opens the prompt", async () => {
    $fetch.mockResolvedValueOnce({ data: OPTIONS, error: null } as never);

    const result = await signInWithPasskey({ autofill: true, isCurrent: () => false });

    expect(result).toEqual({ outcome: "stale" });
    // Starting it would abort the newer attempt's prompt.
    expect(start).not.toHaveBeenCalled();
  });

  test("an attempt aborted by a newer one is stale, not an error", async () => {
    $fetch.mockResolvedValueOnce({ data: OPTIONS, error: null } as never);
    let valid = true;
    start.mockImplementation(async () => {
      valid = false;
      throw new WebAuthnError({
        message: "aborted",
        code: "ERROR_CEREMONY_ABORTED",
        cause: new Error("AbortError"),
      });
    });

    const result = await signInWithPasskey({ autofill: true, isCurrent: () => valid });
    expect(result).toEqual({ outcome: "stale" });
  });

  test("a closed prompt keeps @simplewebauthn's code", async () => {
    $fetch.mockResolvedValueOnce({ data: OPTIONS, error: null } as never);
    start.mockRejectedValue(
      new WebAuthnError({
        message: "NotAllowedError",
        code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
        cause: new Error("NotAllowedError"),
      }),
    );

    expect(await signInWithPasskey({ autofill: false, isCurrent: current })).toEqual({
      outcome: "failed",
      error: { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" },
    });
  });

  test("server errors keep their status and code; network failures are marked", async () => {
    $fetch.mockResolvedValueOnce({ data: null, error: { status: 429 } } as never);
    expect(await signInWithPasskey({ autofill: false, isCurrent: current })).toEqual({
      outcome: "failed",
      error: { status: 429, code: undefined },
    });

    $fetch.mockResolvedValueOnce({ data: OPTIONS, error: null } as never).mockResolvedValueOnce({
      data: null,
      error: { status: 401, code: "PASSKEY_NOT_FOUND" },
    } as never);
    start.mockResolvedValue(CREDENTIAL as never);
    expect(await signInWithPasskey({ autofill: false, isCurrent: current })).toEqual({
      outcome: "failed",
      error: { status: 401, code: "PASSKEY_NOT_FOUND" },
    });

    $fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await signInWithPasskey({ autofill: false, isCurrent: current })).toEqual({
      outcome: "failed",
      error: { status: undefined, code: "NETWORK_ERROR" },
    });
  });
});
