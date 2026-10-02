import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_`-prefixed names are deliberately unused (destructuring rest, callback slots).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // React Compiler is not enabled here, so manual memoization is not something it can preserve.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    // CommonJS test harnesses: require() is the module system, not a style choice.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop build staging area (contains a copied Next.js server tree).
    "src-tauri/**",
    // Generated design-reference bundle, not app code.
    "design/support.js",
    // Agent worktrees.
    ".claude/**",
  ]),
]);

export default eslintConfig;
