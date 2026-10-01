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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  designTokensOnly,
  screenshotsThroughHelper,
  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]),
]);

export default eslintConfig;
