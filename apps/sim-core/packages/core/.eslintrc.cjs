module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    jsx: true,
    useJSXTextNode: true,
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  env: { browser: true, es2020: true },
  ignorePatterns: ["dist"],
  settings: {
    react: {
      version: "detect",
    },
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:react-hooks/recommended",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "plugin:react/jsx-runtime",
    "plugin:react/recommended",
    "prettier",
  ],
  plugins: ["react-refresh", "@typescript-eslint", "react-hooks", "react", "import"],
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
    // "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_+", varsIgnorePattern: "^_+" },
    ],
    "no-unused-expressions": "error",
    "prefer-const": "error",
    "react/jsx-key": "error",
    "react/jsx-no-useless-fragment": "error",
    "react/self-closing-comp": "warn",
    eqeqeq: ["error", "always", { null: "ignore" }],
    "react-refresh/only-export-components": [
      "off",
      { allowConstantExport: true },
    ],
    // Disable a bunch of rules to get compilation working in the first place
    // Ideally, all of these items should be removed,
    // as they represent deviations from the standard set.
    "@typescript-eslint/await-thenable": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/no-base-to-string": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-empty-interface": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "@typescript-eslint/no-redundant-type-constituents": "off",
    "@typescript-eslint/no-unnecessary-type-constraint": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-enum-comparison": "off",

    "@typescript-eslint/no-unsafe-member-access": "off", // Disabled due to tech debt
    "@typescript-eslint/no-unsafe-return": "off", // Disabled due to tech debt
    "@typescript-eslint/unbound-method": "off", // Disabled due to tech debt
    "@typescript-eslint/prefer-nullish-coalescing": ["error", {ignoreMixedLogicalExpressions: true, ignorePrimitives: true}],
    "react/prop-types": ["error", { skipUndeclared: true, ignore: ['children'] }], // 'children' prop type detection is buggy
    "react/display-name": "off", // Set automatically during transpilation
    "react/no-unescaped-entities": "off", // Permits more natural language in html, e.g. aprostrophies.
  },
};
