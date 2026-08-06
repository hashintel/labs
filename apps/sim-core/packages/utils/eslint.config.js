const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.{ts,js}"],
    extends: [tseslint.configs.base, eslintConfigPrettier],
    languageOptions: { parser: tseslint.parser },
    rules: { "prefer-const": "error" },
  },
);
