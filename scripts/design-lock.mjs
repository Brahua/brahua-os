// Records (or verifies) the hashes of the design-system files synced from Claude Design.
//   pnpm design:lock          → rewrite src/design-system/styles/claude-design.lock.json
//   pnpm design:lock --check  → fail if a synced file was edited by hand (used in CI)
// Local fixes belong in overrides.css / extensions.css, never in the synced files.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const LOCK = "src/design-system/styles/claude-design.lock.json";
const PROJECT_ID = "3787b11d-b9b0-4ea2-bd5d-26d0f072f863";

// local path → path in the Claude Design project
const SYNCED = {
  "src/design-system/styles/tokens/colors.css": "tokens/colors.css",
  "src/design-system/styles/tokens/shadows.css": "tokens/shadows.css",
  "src/design-system/styles/tokens/spacing.css": "tokens/spacing.css",
  "src/design-system/styles/tokens/motion.css": "tokens/motion.css",
  // Same declarations as the remote file, minus its Google Fonts @import (fonts use next/font).
  "src/design-system/styles/tokens/typography.css": "tokens/typography.css",
  "src/design-system/styles/components.css": "components/components.css",
};

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (process.argv.includes("--check")) {
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  const changed = Object.keys(SYNCED).filter((file) => lock.files[file]?.sha256 !== sha256(file));
  if (changed.length > 0) {
    console.error("Synced design-system files differ from claude-design.lock.json:");
    for (const file of changed) console.error(`  - ${file}`);
    console.error(
      "Put local fixes in overrides.css/extensions.css, or re-sync from Claude Design.",
    );
    process.exit(1);
  }
  console.log(`Design-system files match the lock (${Object.keys(SYNCED).length} files).`);
} else {
  const files = Object.fromEntries(
    Object.entries(SYNCED).map(([file, remote]) => [file, { remote, sha256: sha256(file) }]),
  );
  const lock = {
    source: { tool: "Claude Design", projectId: PROJECT_ID },
    syncedAt: new Date().toISOString(),
    files,
  };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Wrote ${LOCK}`);
}
