// @vitest-environment node
import { describe, expect, test } from "vitest";
import { preflight } from "../../scripts/auth-owner";

const REMOTE = "postgresql://owner:secret@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("pnpm auth:owner preflight (runs before any prompt)", () => {
  test("a placeholder host fails right away, before asking for the host or the password", () => {
    expect(() =>
      preflight({
        DATABASE_URL_UNPOOLED: "postgresql://owner:secret@…/neondb",
        ALLOW_PROD_DB: "1",
        OWNER_EMAIL: "owner@example.com",
      }),
    ).toThrow(/DATABASE_URL_UNPOOLED has no valid host/);
  });

  test("a remote host still needs ALLOW_PROD_DB=1", () => {
    expect(() => preflight({ DATABASE_URL_UNPOOLED: REMOTE, OWNER_EMAIL: "o@example.com" })).toThrow(
      /Refusing/,
    );
  });

  test("the owner email is checked too", () => {
    expect(() => preflight({ DATABASE_URL_UNPOOLED: REMOTE, ALLOW_PROD_DB: "1" })).toThrow(
      /OWNER_EMAIL/,
    );
  });

  test("a valid Neon URL with channel_binding and the owner email pass", () => {
    const url = `${REMOTE}&channel_binding=require`;
    expect(
      preflight({ DATABASE_URL_UNPOOLED: url, ALLOW_PROD_DB: "1", OWNER_EMAIL: " Owner@Example.com" }),
    ).toEqual({ url, email: "owner@example.com" });
  });
});
