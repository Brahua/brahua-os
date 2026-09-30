// Creates the owner account, or resets its password (SPEC-core: no email reset; recovery is
// running this script again). The password is typed in the terminal, hidden, and never read
// from arguments or environment variables. Resetting signs out every existing session.
//   OWNER_EMAIL=… DATABASE_URL_UNPOOLED=… pnpm auth:owner
// Non-local databases also need ALLOW_PROD_DB=1 (same guard as db:seed).
import { pathToFileURL } from "node:url";
import { checkOwnerPassword, isEmail, normalizeEmail } from "@/lib/auth-env";
import { createDb } from "@/lib/db";
import { describeDatabaseTarget, resolveScriptDatabaseUrl } from "@/lib/db-config";
import { upsertOwner } from "@/modules/core/owner";

/** Reads a line from the terminal without echoing it. Requires an interactive terminal. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Cancelado."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    stdin.on("data", onData);
  });
}

async function main() {
  let url: string;
  try {
    url = resolveScriptDatabaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const email = normalizeEmail(process.env.OWNER_EMAIL ?? "");
  if (!isEmail(email)) {
    console.error("OWNER_EMAIL is not set or is not a valid email address.");
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error(
      "Run this in an interactive terminal: the password is only read from the keyboard.",
    );
    process.exit(1);
  }

  console.log(`Target database: ${describeDatabaseTarget(url)}`);
  console.log(`Owner: ${email}`);

  let password = "";
  for (;;) {
    password = await promptHidden("Contraseña (mínimo 12 caracteres): ");
    const confirmation = await promptHidden("Repite la contraseña: ");
    const check = checkOwnerPassword(password, confirmation);
    if (check.ok) break;
    console.error(check.error);
  }

  const db = createDb(url);
  try {
    const result = await upsertOwner(db, { email, password });
    console.log(
      result.created
        ? "Owner created. You can sign in at /login."
        : `Owner password reset. ${result.revokedSessions} session(s) signed out.`,
    );
  } finally {
    await db.$client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
