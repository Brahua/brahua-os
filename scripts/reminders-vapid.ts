// Generates the VAPID key pair for push web (SPEC-reminders "Push web"):
//   pnpm reminders:vapid
// Run it in YOUR OWN terminal. It prints the pair to stdout, once, and writes it nowhere: copy the
// two lines straight into Vercel (Settings → Environment Variables) and the repo secrets
// (`gh secret set`), then clear the terminal. The private key is a secret: never paste it into a
// chat or an agent session, never commit it.
//
// It refuses to run when stdout is not a terminal (a pipe, a redirect, an agent's captured shell,
// a CI log), so the pair cannot end up in a file or a transcript by accident.
import webpush from "web-push";

export function formatVapidPair(keys: { publicKey: string; privateKey: string }): string {
  return [
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    "",
    "Falta VAPID_SUBJECT: mailto:tu@correo o una URL https.",
    "Copia estas líneas en tu terminal a Vercel y a los secretos del repo; no las pegues en ningún chat.",
  ].join("\n");
}

function main(): void {
  if (!process.stdout.isTTY) {
    console.error(
      "Este script solo imprime las claves en una terminal interactiva (no a un archivo, una tubería ni un log). Ejecútalo tú, en tu terminal: pnpm reminders:vapid",
    );
    process.exitCode = 1;
    return;
  }
  console.log(formatVapidPair(webpush.generateVAPIDKeys()));
}

// Imported by a test without running: only a direct run (`tsx scripts/reminders-vapid.ts`) prints.
if (process.argv[1]?.endsWith("reminders-vapid.ts")) main();
