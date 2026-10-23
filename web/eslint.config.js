import tseslint from "typescript-eslint";
import { rules } from "./lint/rules.js";

// The architecture rules (lint/rules.js, client-architecture.md §3.3) sit on strict type-checked
// TypeScript. lint/rules.test.ts proves each one fails on a seeded violation.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  ...rules,
  { files: ["**/*.js", "**/*.mjs"], ...tseslint.configs.disableTypeChecked },
);
