// Creates the owner account, or resets its password (SPEC-core: no email reset; recovery is
// running this script again). The password is typed in the terminal, hidden, and never read
// from arguments or environment variables. Resetting signs out every existing session.
//   OWNER_EMAIL=… DATABASE_URL_UNPOOLED=… pnpm auth:owner
// Non-local databases need ALLOW_PROD_DB=1 (a Vercel build is never permission) and typing the
// database host back before the password prompt.
import { pathToFileURL } from "node:url";
import { checkOwnerPassword, isEmail, normalizeEmail } from "@/lib/auth-env";
import { createDb } from "@/lib/db";
import {
  databaseHost,
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  resolveOwnerScriptDatabaseUrl,
} from "@/lib/db-config";
import { upsertOwner } from "@/modules/core/owner";

const CANCELLED = "Cancelado.";

/**
 * Reads a line from the terminal in raw mode. `hidden` never echoes what is typed.
 * Ctrl-C and Ctrl-D (end of input) cancel. Requires an interactive terminal.
 */
function prompt(question: string, { hidden }: { hidden: boolean }): Promise<string> {
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
      stdin.removeListener("end", onEnd);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003" || char === "\u0004") return finish(new Error(CANCELLED));
        if (char === "\u007f" || char === "\b") {
          if (value && !hidden) stdout.write("\b \b");
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
          if (!hidden) stdout.write(char);
        }
      }
    }
    // End of input (e.g. a closed terminal) also cancels instead of hanging.
    function onEnd() {
      finish(new Error(CANCELLED));
    }
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}

async function main() {
  let url: string;
  try {
    url = resolveOwnerScriptDatabaseUrl(process.env);
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

  if (!isLocalDatabaseUrl(url)) {
    const host = databaseHost(url);
    const typed = await prompt(`Remote database. Type its host (${host}) to continue: `, {
      hidden: false,
    });
    if (typed.trim() !== host) {
      console.error("The host does not match. Nothing was changed.");
      process.exit(1);
    }
  }

  let password = "";
  for (;;) {
    password = await prompt("Contraseña (mínimo 12 caracteres): ", { hidden: true });
    const confirmation = await prompt("Repite la contraseña: ", { hidden: true });
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
