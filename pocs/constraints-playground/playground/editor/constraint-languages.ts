import type { languages } from "monaco-editor/editor/editor.api.js";

/**
 * The tokenizers of the constraint file and of the Math view. Both give a
 * construct the same token, so the same colour: `temporal`, `logic`,
 * `metric` (metric names and the places and transitions inside count and
 * fired), `comparator`, `quantity`, `window` and `hole`. The file adds `key`
 * for its muted YAML keys. `swiss-theme.ts` colours the tokens.
 */

const TEMPORAL_WORDS = ["always", "eventually", "until", "weak_until", "weak"];
const LOGIC_WORDS = ["and", "or", "not", "implies", "iff", "if", "then", "else"];
const REFERENCE_WORDS = ["count", "fired"];

/** The rules both grammars share, tried after the rules that only one of them has. */
const EXPRESSION_RULES: languages.IMonarchLanguageRule[] = [
  [/\[\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\]/u, "window"],
  [/weak\s+until(?![A-Za-z0-9_])/u, "temporal"],
  [/\d+(?:\.\d+)?/u, "quantity"],
  [/[∧∨¬→↔!]/u, "logic"],
  [/<=|>=|==|!=|[<>=≤≥≠]/u, "comparator"],
  [/_(?![A-Za-z0-9_])|□/u, "hole"],
  [/[GFUW](?![A-Za-z0-9_])/u, "temporal"],
  [
    /[a-z_]\w*/u,
    {
      cases: {
        "@temporalWords": "temporal",
        "@logicWords": "logic",
        "@referenceWords": "metric",
        "@keywords": "quantity",
        "@default": "identifier",
      },
    },
  ],
  [/[A-Z]\w*/u, "metric"],
  [/[()[\],]/u, "delimiter"],
  [/[+\-*/]/u, "operators"],
];

const WORD_LISTS = {
  temporalWords: TEMPORAL_WORDS,
  logicWords: LOGIC_WORDS,
  referenceWords: REFERENCE_WORDS,
  keywords: ["true", "false"],
};

/** `constraint.yaml`: muted keys, a plain name, and the expression grammar in every value. */
export const constraintYamlTokens: languages.IMonarchLanguage = {
  tokenPostfix: ".constraint-yaml",
  ...WORD_LISTS,
  tokenizer: {
    root: [
      [/#.*$/u, "comment"],
      [/^(\s*)(name)(\s*:)(.*)$/u, ["", "key", "delimiter", "string"]],
      [/^\s*[a-z]\w*(?=\s*:)/u, "key"],
      [/^\s*[A-Z]\w*(?=\s*:)/u, "metric"],
      [/:|\|/u, "delimiter"],
      [/["']/u, "delimiter"],
      ...EXPRESSION_RULES,
    ],
  },
};

/** The Math view: the formula, and one `Name := expression` line per metric. */
export const constraintMathTokens: languages.IMonarchLanguage = {
  tokenPostfix: ".constraint-math",
  ...WORD_LISTS,
  tokenizer: {
    root: [[/:=/u, "delimiter"], ...EXPRESSION_RULES],
  },
};

export const constraintMathConfiguration: languages.LanguageConfiguration = {
  brackets: [
    ["(", ")"],
    ["[", "]"],
  ],
};
