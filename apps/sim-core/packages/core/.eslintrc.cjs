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
  env: { browser: true, es2020: true, node: true },
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
  plugins: ["@typescript-eslint", "react-hooks", "react", "import"],
  rules: {
    // Augmentations
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": [
      "warn",
      {
        additionalHooks: "(^useModal$)|(^useUserGatedEffect$)",
      },
    ],

    // Preferences
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_+", varsIgnorePattern: "^_+" },
    ],
    "no-unused-expressions": "error",
    "prefer-const": "error",
    "react/jsx-key": "error",
    "react/jsx-no-useless-fragment": "error",
    "react/self-closing-comp": "error",
    eqeqeq: ["error", "always", { null: "ignore" }],

    // Disabled due to tech debt
    // Ideally each of these would be brought back into play, but they're not small potatoes.
    "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-enum-comparison": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/unbound-method": "off",
    "@typescript-eslint/prefer-nullish-coalescing": [
      "error",
      { ignoreMixedLogicalExpressions: true, ignorePrimitives: true },
    ],

    // Deliberately disabled to ease use of React/Redux
    "@typescript-eslint/await-thenable": "off", // Redux/Dispatch uses this a lot.
    "@typescript-eslint/no-empty-function": "off", // React uses this a lot.
    "@typescript-eslint/no-floating-promises": "off", // redux 'dispatch' and other react hooks create lots of floating promises.
    "@typescript-eslint/no-misused-promises": [
      "error",
      {
        checksVoidReturn: false, // Void-returned promises come up a lot in react
      },
    ],
    "react/prop-types": [
      "error",
      { skipUndeclared: true, ignore: ["children"] }, // 'children' prop type detection is buggy
    ],
    "react/display-name": "off", // Set automatically during transpilation, so disable it here.
    "react/no-unescaped-entities": "off", // Permits more natural language in html, e.g. aprostrophies.
  },
};
