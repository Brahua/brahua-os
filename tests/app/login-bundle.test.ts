import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

// SPEC-core (LCP on /login): the sign-in code (Better Auth client, WebAuthn ceremony) loads on
// demand, so it stays out of the JavaScript /login downloads and runs before its first paint.
// A static import would bring it back; type-only imports are fine (they are erased).
const SRC = path.resolve(__dirname, "../../src");
const ON_DEMAND = ["@/lib/auth-client", "@/lib/passkey-sign-in", "@simplewebauthn/browser"];

test.each([
  "app/(auth)/login/login-form.tsx",
  // Part of the shell, which the root 404 ships with every page (/login included).
  "modules/core/components/session-refresher.tsx",
])("%s loads the sign-in code on demand", (file) => {
  const source = readFileSync(path.join(SRC, file), "utf8");
  for (const specifier of ON_DEMAND) {
    const staticImport = new RegExp(`^import (?!type )[^;]*from "${specifier}";`, "m");
    expect(source, `${file} imports ${specifier} statically`).not.toMatch(staticImport);
  }
  expect(source).toMatch(/import\("@\/lib\/auth-client"\)/);
});
