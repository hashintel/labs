const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    extends: [tseslint.configs.base, eslintConfigPrettier],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        jsx: true,
      },
    },
    rules: {
      "id-length": [
        "error",
        {
          min: 2,
          exceptions: ["_", "x", "y", "z", "a", "b"],
          properties: "never",
        },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": [
        "warn",
        {
          additionalHooks: "(^useModal$)|(^useUserGatedEffect$)",
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_+", varsIgnorePattern: "^_+" },
      ],
      "no-unused-expressions": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
);
