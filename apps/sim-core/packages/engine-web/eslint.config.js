const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-node/**",
      "wasm/**",
      "node_modules/**",
      "src/engine-web/simulation/python/pyodide.js",
    ],
  },
  {
    files: ["**/*.{ts,js}"],
    extends: [tseslint.configs.base, eslintConfigPrettier],
    languageOptions: { parser: tseslint.parser },
    rules: { "prefer-const": "error" },
  },
);
