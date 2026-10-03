import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Raw colors and easings belong to the design system; everything else uses its tokens.
const HEX_COLOR = String.raw`#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`;
const RAW_STYLE_MESSAGE =
  "Usa los tokens del design system (clases bo-* o utilidades como bg-key / text-text-secondary) en vez de valores sueltos.";

const designTokensOnly = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/design-system/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `Literal[value=/${HEX_COLOR}/]`,
        message: `Color hex suelto. ${RAW_STYLE_MESSAGE}`,
      },
      {
        selector: `TemplateElement[value.raw=/${HEX_COLOR}/]`,
        message: `Color hex suelto. ${RAW_STYLE_MESSAGE}`,
      },
      {
        selector: "Literal[value=/cubic-bezier\\(/]",
        message: `Curva de animación suelta. Usa las variables --ease-* del design system.`,
      },
      {
        selector: "TemplateElement[value.raw=/cubic-bezier\\(/]",
        message: `Curva de animación suelta. Usa las variables --ease-* del design system.`,
      },
    ],
  },
};

// Screenshots go through e2e/support/screenshots.ts, which knows where references are valid.
const screenshotsThroughHelper = {
  files: ["e2e/**/*.ts"],
  ignores: ["e2e/support/screenshots.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[property.name=/^(toHaveScreenshot|toMatchSnapshot)$/]",
        message:
          "Usa expectScreenshot() de e2e/support/screenshots.ts: solo compara en la imagen Linux de Playwright y anota el salto en las demás.",
      },
    ],
  },
};

// Module boundaries (CAPABILITY-MAP: core ← projects ← tasks; core ← habits). A module never imports one that
// depends on it: cross-module features go through registered contracts and the composition roots
// in src/lib (progress-sources.ts, project-extensions.ts, capture-providers.tsx).
const TASKS_IMPORT = {
  group: ["@/modules/tasks", "@/modules/tasks/*"],
  message:
    "`tasks` depende de este módulo: usa un contrato registrado (p. ej. registerProjectSection) y su raíz de composición en src/lib.",
};
const PROJECTS_IMPORT = {
  group: ["@/modules/projects", "@/modules/projects/*"],
  message: "`projects` depende de `core`: core no puede importarlo (usa un contrato registrado).",
};
// `habits` depends on `core` only (SPEC-habits "Límites entre módulos"); none of the others
// imports it but `today`.
const HABITS_IMPORT = {
  group: ["@/modules/habits", "@/modules/habits/*"],
  message:
    "`habits` depende de `core`: core, projects y tasks no pueden importarlo (usa un contrato registrado).",
};
// `today` is a leaf (SPEC-today "Contratos"): it reads the others' contracts and nobody imports
// it. Only the home page (src/app) and the registry (src/lib/modules.ts) do.
const TODAY_IMPORT = {
  group: ["@/modules/today", "@/modules/today/*"],
  message:
    "`today` es una hoja: ningún módulo lo importa (expón un contrato en tu módulo y que `today` lo lea).",
};
const moduleBoundaries = [
  {
    files: ["src/modules/habits/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [TODAY_IMPORT] }] },
  },
  {
    files: ["src/modules/tasks/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [HABITS_IMPORT, TODAY_IMPORT] }] },
  },
  {
    files: ["src/modules/projects/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [TASKS_IMPORT, HABITS_IMPORT, TODAY_IMPORT] }],
    },
  },
  {
    files: ["src/modules/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [TASKS_IMPORT, PROJECTS_IMPORT, HABITS_IMPORT, TODAY_IMPORT] },
      ],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  designTokensOnly,
  screenshotsThroughHelper,
  ...moduleBoundaries,
  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]),
]);

export default eslintConfig;
