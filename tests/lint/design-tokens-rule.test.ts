import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, test } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(process.cwd(), file) });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("design tokens lint rule", () => {
  test("rejects raw hex colors in module code", async () => {
    const messages = await lint(
      'export const Tag = () => <span style={{ color: "#FF4A1C" }}>Hoy</span>;\n',
      "src/modules/today/tag.tsx",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Color hex suelto");
  });

  test("rejects Tailwind arbitrary colors in class names", async () => {
    const messages = await lint(
      'export const Box = () => <div className="bg-[#161616]" />;\n',
      "src/app/page.tsx",
    );
    expect(messages).toHaveLength(1);
  });

  test("rejects raw easings, also inside template literals", async () => {
    const messages = await lint(
      "const ms = 90;\nexport const t = `transform ${ms}ms cubic-bezier(0.3, 0, 0, 1)`;\n",
      "src/modules/habits/motion.ts",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Curva de animación suelta");
  });

  test("allows raw values inside the design system", async () => {
    const messages = await lint(
      'export const SIGNAL = "#FF4A1C";\nexport const EASE = "cubic-bezier(0.3, 0, 0, 1)";\n',
      "src/design-system/raw.ts",
    );
    expect(messages).toEqual([]);
  });

  test("does not flag ordinary strings with #", async () => {
    const messages = await lint(
      'export const href = "#key";\nexport const label = "Tarea #12";\n',
      "src/modules/tasks/labels.ts",
    );
    expect(messages).toEqual([]);
  });
});
