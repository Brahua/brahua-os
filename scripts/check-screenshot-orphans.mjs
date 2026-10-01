// Fails when e2e/__screenshots__ holds references that no test compared in the last run
// (orphans: a renamed or removed capture). Only meaningful after the FULL E2E suite ran inside the
// Playwright image, where expectScreenshot() records what it used (CI and update-screenshots.yml).
//
//   node scripts/check-screenshot-orphans.mjs           # list orphans, exit 1 if any
//   node scripts/check-screenshot-orphans.mjs --delete  # delete them (update-screenshots.yml)
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const USED_DIR = "test-results/.screenshots-used"; // Same as e2e/support/screenshots.ts.
const REFERENCES = "e2e/__screenshots__";
const remove = process.argv.includes("--delete");

if (!existsSync(USED_DIR)) {
  console.error(
    "::error::No screenshot was compared in this run: run the full E2E suite in the Playwright image first.",
  );
  process.exit(1);
}

const used = new Set(
  readdirSync(USED_DIR).flatMap((file) =>
    readFileSync(path.join(USED_DIR, file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((reference) => path.normalize(reference)),
  ),
);
const references = existsSync(REFERENCES)
  ? readdirSync(REFERENCES, { recursive: true })
      .filter((file) => file.endsWith(".png"))
      .map((file) => path.join(REFERENCES, file))
  : [];
const orphans = references.filter((reference) => !used.has(reference)).sort();

if (orphans.length === 0) {
  console.log(`No orphan screenshots (${references.length} references, all used).`);
} else if (remove) {
  for (const orphan of orphans) {
    rmSync(orphan);
    console.log(`Deleted orphan ${orphan}`);
  }
} else {
  for (const orphan of orphans) {
    console.error(`::error file=${orphan}::No test compares this screenshot any more.`);
  }
  console.error("Delete them, or run update-screenshots.yml on the branch (it deletes orphans).");
  process.exit(1);
}
