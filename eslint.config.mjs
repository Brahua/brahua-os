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

// Module boundaries (CAPABILITY-MAP: core ← projects ← tasks; core ← habits; core ← finance; core ← reminders). A module never imports one that
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
// `finance` depends on `core` only (SPEC-finance "Contratos"); none of the others imports it but
// `today` (F4, through FINANCE_FOR_TODAY). It imports no module but `core` either.
const FINANCE_IMPORT = {
  group: ["@/modules/finance", "@/modules/finance/*"],
  message:
    "`finance` depende de `core`: core, projects, tasks y habits no pueden importarlo (usa un contrato registrado).",
};
const FINANCE_ONLY_CORE = {
  group: [
    "@/modules/projects",
    "@/modules/projects/*",
    "@/modules/tasks",
    "@/modules/tasks/*",
    "@/modules/habits",
    "@/modules/habits/*",
  ],
  message: "`finance` solo depende de `core`: no importa otros módulos.",
};
// `today` reads `finance` (F4) only through what finance offers the home page: the contract, its
// rows' type, paying (`paymentCompletion`), the row and the sheet, and the routes. Never its data
// layer, actions or screens.
const FINANCE_FOR_TODAY = {
  // Gitignore-style: a file can only be let back in when its folder isn't left out, so the barrel
  // is an exact path (FINANCE_BARREL_FOR_TODAY) and `components` is let in before its files.
  group: [
    "@/modules/finance/*",
    "!@/modules/finance/contracts",
    "!@/modules/finance/today-summary",
    "!@/modules/finance/payment-completion",
    "!@/modules/finance/routes",
    "!@/modules/finance/components",
    "@/modules/finance/components/*",
    "!@/modules/finance/components/payment-today-row",
    "!@/modules/finance/components/today-pay-sheet",
  ],
  message:
    "`today` lee `finance` solo por lo que expone para la portada: contracts, today-summary, payment-completion, routes y los componentes payment-today-row y today-pay-sheet.",
};
// An exact path (a pattern would match everything under it).
const FINANCE_BARREL_FOR_TODAY = { name: "@/modules/finance", message: FINANCE_FOR_TODAY.message };
// `reminders` depends on `core` only (SPEC-reminders "Contratos"): it imports no other module, and
// `tasks`, `habits` and `finance` import nothing of it but its contracts (`registerReminderSource`
// and the types). Everything else (engine, channels, settings) is private to `reminders`.
const REMINDERS_MESSAGE =
  "`reminders` depende de `core`: los demás módulos solo importan `@/modules/reminders/contracts` (registerReminderSource y sus tipos).";
// Same gotcha as FINANCE_FOR_TODAY: a file can only be let back in when its folder isn't left
// out, so the folder itself (the barrel) is an exact path and only its children are a pattern.
const REMINDERS_IMPORT = {
  group: ["@/modules/reminders/*", "!@/modules/reminders/contracts"],
  message: REMINDERS_MESSAGE,
};
const REMINDERS_BARREL = { name: "@/modules/reminders", message: REMINDERS_MESSAGE };
const REMINDERS_ONLY_CORE = {
  group: [
    "@/modules/projects",
    "@/modules/projects/*",
    "@/modules/tasks",
    "@/modules/tasks/*",
    "@/modules/habits",
    "@/modules/habits/*",
    "@/modules/finance",
    "@/modules/finance/*",
    "@/modules/today",
    "@/modules/today/*",
  ],
  message:
    "`reminders` solo depende de `core`: no importa otros módulos (ellos le registran sus fuentes por `contracts`).",
};
// `goals` (SPEC-goals "Contratos") sits above `habits` and `projects`: it reads them only through
// their contracts (`getHabitDoneDays`, `getProjectProgress`, the option lists) and their `routes`
// (client-safe URL helpers for the links), and imports no other module but `core`. None of the
// others imports `goals`: the links from a habit's or project's page to its goal go through a
// registered section (G3) composed in src/lib/goal-extensions.ts.
const GOALS_IMPORT = {
  group: ["@/modules/goals/*"],
  message:
    "`goals` depende de este módulo: no puede importarlo (usa un contrato registrado y su raíz de composición en src/lib/goal-extensions.ts).",
};
const GOALS_BARREL = { name: "@/modules/goals", message: GOALS_IMPORT.message };
// Same gotcha as REMINDERS_IMPORT: a folder can only be let back in when it isn't left out, so
// the barrel is an exact path and the contracts and routes are let in after their folder pattern.
const GOALS_ONLY_CONTRACTS = {
  group: [
    "@/modules/habits/*",
    "!@/modules/habits/contracts",
    "!@/modules/habits/routes",
    "@/modules/projects/*",
    "!@/modules/projects/contracts",
    "!@/modules/projects/routes",
  ],
  message:
    "`goals` lee `habits` y `projects` solo por sus contratos (`contracts`) y sus rutas (`routes`).",
};
const GOALS_NO_BARRELS = [
  { name: "@/modules/habits", message: GOALS_ONLY_CONTRACTS.message },
  { name: "@/modules/projects", message: GOALS_ONLY_CONTRACTS.message },
];
const GOALS_ONLY_CORE_AND_CONTRACTS = {
  group: [
    "@/modules/tasks",
    "@/modules/tasks/*",
    "@/modules/finance",
    "@/modules/finance/*",
    "@/modules/reminders",
    "@/modules/reminders/*",
    "@/modules/today",
    "@/modules/today/*",
  ],
  message:
    "`goals` depende de `core`, `habits` y `projects`: no importa otros módulos (ellos le registran secciones por contrato).",
};
// `weekly-review` (SPEC-weekly-review "Contratos") is a consumer above `habits`, `tasks`, `projects`
// and `goals`: it reads them only through their contracts (and their client-safe routes) and
// nobody imports it. The invitation card (W4) reaches `today` and `goals` through the composition
// root src/lib/review-extensions.ts, which is outside these modules.
const WEEKLY_REVIEW_IMPORT = {
  group: ["@/modules/weekly-review", "@/modules/weekly-review/*"],
  message:
    "`weekly-review` depende de este módulo: no puede importarlo (la tarjeta de invitación entra por la raíz de composición en src/lib/review-extensions.ts).",
};
const WEEKLY_REVIEW_MESSAGE =
  "`weekly-review` lee `habits`, `tasks`, `projects` y `goals` solo por sus contratos (`contracts`) y sus rutas (`routes`).";
// Same gotcha as GOALS_ONLY_CONTRACTS: a folder can only be let back in when it isn't left out, so
// the contracts and routes are let in after their folder pattern and the barrels are exact paths.
const WEEKLY_REVIEW_ONLY_CONTRACTS = {
  group: [
    "@/modules/habits/*",
    "!@/modules/habits/contracts",
    "!@/modules/habits/routes",
    "@/modules/tasks/*",
    "!@/modules/tasks/contracts",
    "!@/modules/tasks/routes",
    "@/modules/projects/*",
    "!@/modules/projects/contracts",
    "!@/modules/projects/routes",
    "@/modules/goals/*",
    "!@/modules/goals/contracts",
    "!@/modules/goals/routes",
  ],
  message: WEEKLY_REVIEW_MESSAGE,
};
const WEEKLY_REVIEW_NO_BARRELS = [
  { name: "@/modules/habits", message: WEEKLY_REVIEW_MESSAGE },
  { name: "@/modules/tasks", message: WEEKLY_REVIEW_MESSAGE },
  { name: "@/modules/projects", message: WEEKLY_REVIEW_MESSAGE },
  { name: "@/modules/goals", message: WEEKLY_REVIEW_MESSAGE },
];
const WEEKLY_REVIEW_ONLY_CORE_AND_CONTRACTS = {
  group: [
    "@/modules/finance",
    "@/modules/finance/*",
    "@/modules/reminders",
    "@/modules/reminders/*",
    "@/modules/today",
    "@/modules/today/*",
  ],
  message:
    "`weekly-review` depende de `core`, `habits`, `tasks`, `projects` y `goals`: no importa otros módulos.",
};
const moduleBoundaries = [
  {
    files: ["src/modules/goals/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: GOALS_NO_BARRELS,
          patterns: [GOALS_ONLY_CONTRACTS, GOALS_ONLY_CORE_AND_CONTRACTS, WEEKLY_REVIEW_IMPORT],
        },
      ],
    },
  },
  {
    // The one exception: a foreign key needs the table itself (`tasks` does the same with
    // `projects`), so the schema file may import the tables of `habits` and `projects`.
    files: ["src/modules/goals/db/schema.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: GOALS_NO_BARRELS,
          // Only the other modules' folders stay closed; the tables are let in by leaving the
          // habits/projects pattern out (a negation can't reopen a file inside a closed folder).
          patterns: [GOALS_ONLY_CORE_AND_CONTRACTS, WEEKLY_REVIEW_IMPORT],
        },
      ],
    },
  },
  {
    files: ["src/modules/weekly-review/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: WEEKLY_REVIEW_NO_BARRELS,
          patterns: [WEEKLY_REVIEW_ONLY_CONTRACTS, WEEKLY_REVIEW_ONLY_CORE_AND_CONTRACTS],
        },
      ],
    },
  },
  {
    files: ["src/modules/today/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [FINANCE_BARREL_FOR_TODAY, REMINDERS_BARREL],
          patterns: [FINANCE_FOR_TODAY, REMINDERS_IMPORT, WEEKLY_REVIEW_IMPORT],
        },
      ],
    },
  },
  {
    files: ["src/modules/reminders/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [GOALS_BARREL],
          patterns: [REMINDERS_ONLY_CORE, GOALS_IMPORT, WEEKLY_REVIEW_IMPORT],
        },
      ],
    },
  },
  {
    files: ["src/modules/finance/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [REMINDERS_BARREL, GOALS_BARREL],
          patterns: [
            FINANCE_ONLY_CORE,
            TODAY_IMPORT,
            REMINDERS_IMPORT,
            GOALS_IMPORT,
            WEEKLY_REVIEW_IMPORT,
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/habits/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [REMINDERS_BARREL, GOALS_BARREL],
          patterns: [
            FINANCE_IMPORT,
            TODAY_IMPORT,
            REMINDERS_IMPORT,
            GOALS_IMPORT,
            WEEKLY_REVIEW_IMPORT,
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/tasks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [REMINDERS_BARREL, GOALS_BARREL],
          patterns: [
            HABITS_IMPORT,
            FINANCE_IMPORT,
            TODAY_IMPORT,
            REMINDERS_IMPORT,
            GOALS_IMPORT,
            WEEKLY_REVIEW_IMPORT,
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/projects/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [REMINDERS_BARREL, GOALS_BARREL],
          patterns: [
            TASKS_IMPORT,
            HABITS_IMPORT,
            FINANCE_IMPORT,
            TODAY_IMPORT,
            REMINDERS_IMPORT,
            GOALS_IMPORT,
            WEEKLY_REVIEW_IMPORT,
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [REMINDERS_BARREL, GOALS_BARREL],
          patterns: [
            TASKS_IMPORT,
            PROJECTS_IMPORT,
            HABITS_IMPORT,
            FINANCE_IMPORT,
            TODAY_IMPORT,
            REMINDERS_IMPORT,
            GOALS_IMPORT,
            WEEKLY_REVIEW_IMPORT,
          ],
        },
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
