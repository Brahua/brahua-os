import { describe, expect, test } from "vitest";
import {
  checkOwnerPassword,
  DEV_ORIGIN,
  isOwnerEmail,
  PRODUCTION_ORIGIN,
  resolveAuthEnv,
} from "@/lib/auth-env";

const SECRET = "a".repeat(32);
const VALID = {
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "https://os.brahua.com",
  OWNER_EMAIL: "Owner@Example.com ",
};

describe("resolveAuthEnv", () => {
  test("names every missing variable at once, without values", () => {
    expect(() => resolveAuthEnv({})).toThrow(
      /BETTER_AUTH_SECRET is not set[\s\S]*OWNER_EMAIL is not set[\s\S]*BETTER_AUTH_URL is not set/,
    );
  });

  test("rejects short and placeholder secrets", () => {
    expect(() => resolveAuthEnv({ ...VALID, BETTER_AUTH_SECRET: "short" })).toThrow(/at least 32/);
    expect(() =>
      resolveAuthEnv({ ...VALID, BETTER_AUTH_SECRET: "better-auth-secret-123456789" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthEnv({ ...VALID, BETTER_AUTH_SECRET: "short" })).not.toThrow(/short/);
  });

  test("rejects an invalid owner email or base URL", () => {
    expect(() => resolveAuthEnv({ ...VALID, OWNER_EMAIL: "nope" })).toThrow(/OWNER_EMAIL/);
    expect(() => resolveAuthEnv({ ...VALID, BETTER_AUTH_URL: "not a url" })).toThrow(
      /BETTER_AUTH_URL is not a valid URL/,
    );
  });

  test("requires https in Vercel production", () => {
    expect(() =>
      resolveAuthEnv({
        ...VALID,
        BETTER_AUTH_URL: "http://os.brahua.com",
        VERCEL_ENV: "production",
      }),
    ).toThrow(/https/);
  });

  test("production: secure cookies and only the production origin", () => {
    const env = resolveAuthEnv({ ...VALID, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(env).toEqual({
      secret: SECRET,
      baseURL: PRODUCTION_ORIGIN,
      ownerEmail: "owner@example.com",
      trustedOrigins: [PRODUCTION_ORIGIN],
      secureCookies: true,
    });
  });

  test("development also trusts localhost:3000 and allows http", () => {
    const env = resolveAuthEnv({
      ...VALID,
      BETTER_AUTH_URL: "http://localhost:3417/",
      NODE_ENV: "development",
    });
    expect(env.baseURL).toBe("http://localhost:3417");
    expect(env.trustedOrigins).toEqual(["http://localhost:3417", DEV_ORIGIN]);
    expect(env.secureCookies).toBe(false);
  });

  test("a production build served over http locally (E2E) does not trust localhost:3000", () => {
    const env = resolveAuthEnv({
      ...VALID,
      BETTER_AUTH_URL: "http://localhost:3417",
      NODE_ENV: "production",
    });
    expect(env.trustedOrigins).toEqual(["http://localhost:3417"]);
  });

  test("trusts the current preview origin (SPEC-core)", () => {
    const env = resolveAuthEnv({
      ...VALID,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "brahua-os-git-x.vercel.app",
      NODE_ENV: "production",
    });
    expect(env.trustedOrigins).toContain("https://brahua-os-git-x.vercel.app");
  });
});

describe("isOwnerEmail", () => {
  test("ignores case and surrounding spaces", () => {
    expect(isOwnerEmail(" OWNER@example.com", "owner@example.com")).toBe(true);
  });

  test("rejects any other email and empty values", () => {
    expect(isOwnerEmail("owner@example.co", "owner@example.com")).toBe(false);
    expect(isOwnerEmail("", "owner@example.com")).toBe(false);
    expect(isOwnerEmail(null, "owner@example.com")).toBe(false);
  });
});

describe("checkOwnerPassword", () => {
  test("requires at least 12 characters", () => {
    expect(checkOwnerPassword("a".repeat(11), "a".repeat(11))).toMatchObject({ ok: false });
    expect(checkOwnerPassword("a".repeat(12), "a".repeat(12))).toEqual({ ok: true });
  });

  test("rejects more than 128 characters", () => {
    const long = "a".repeat(129);
    expect(checkOwnerPassword(long, long)).toMatchObject({ ok: false });
  });

  test("rejects leading or trailing spaces and a mismatched confirmation", () => {
    expect(checkOwnerPassword(" abcdefghijkl", " abcdefghijkl")).toMatchObject({ ok: false });
    expect(checkOwnerPassword("abcdefghijkl", "abcdefghijkm")).toEqual({
      ok: false,
      error: "Las contraseñas no coinciden.",
    });
  });
});
