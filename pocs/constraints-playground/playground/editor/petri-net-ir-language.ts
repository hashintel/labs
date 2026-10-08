import {
  conf as yamlConfiguration,
  language as yamlLanguage,
} from "monaco-editor/languages/definitions/yaml/yaml.js";

import { constraintMathConfiguration, constraintMathTokens, constraintYamlTokens } from "./constraint-languages";
import { completionsAt } from "./petri-net-ir-language/completions";

import type { IDisposable, languages } from "monaco-editor/editor/editor.api.js";
import type { Monaco } from "./monaco";

/**
 * The `petri-net-ir` language: Monaco's YAML Monarch tokenizer and
 * configuration under the IR's own id, plus a completion provider that knows
 * the IR's keys per nesting level and the names declared above the cursor.
 * `constraint-yaml` and `constraint-math` have their own tokenizers, in
 * `constraint-languages.ts`, for constraint.yaml and the Math view.
 */

export const PETRI_NET_IR_LANGUAGE = "petri-net-ir";
export const CONSTRAINT_YAML_LANGUAGE = "constraint-yaml";
export const CONSTRAINT_MATH_LANGUAGE = "constraint-math";

const tokenizer: languages.IMonarchLanguage = {
  ...yamlLanguage,
  tokenPostfix: ".petri-net-ir",
};

function completionKind(
  monaco: Monaco,
  kind: "key" | "value" | "name",
): languages.CompletionItemKind {
  switch (kind) {
    case "key":
      return monaco.languages.CompletionItemKind.Property;
    case "value":
      return monaco.languages.CompletionItemKind.EnumMember;
    case "name":
      return monaco.languages.CompletionItemKind.Variable;
  }
}

function completionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    triggerCharacters: [" "],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions = completionsAt(
        model.getValue(),
        position.lineNumber,
        position.column,
      ).map(
        // The line on each completion is prose: a description beside the label, and the
        // documentation of the expanded panel. Monaco's `detail` is for a short signature,
        // which it breaks mid-word in a header sized for one line.
        (completion, index): languages.CompletionItem => ({
          label:
            completion.detail === undefined
              ? completion.label
              : { label: completion.label, description: completion.detail },
          insertText: completion.insertText,
          kind: completionKind(monaco, completion.kind),
          range,
          sortText: String(index).padStart(3, "0"),
          ...(completion.detail === undefined ? {} : { documentation: completion.detail }),
        }),
      );
      return { suggestions };
    },
  };
}

/** Registers the language and its providers; the disposables take the providers back. */
export function registerPetriNetIrLanguage(monaco: Monaco): IDisposable[] {
  monaco.languages.register({
    id: PETRI_NET_IR_LANGUAGE,
    extensions: [".pn.yaml"],
    aliases: ["Petri net IR"],
  });
  monaco.languages.register({
    id: CONSTRAINT_YAML_LANGUAGE,
    extensions: [".constraint.yaml"],
    aliases: ["Constraint YAML"],
  });
  monaco.languages.register({
    id: CONSTRAINT_MATH_LANGUAGE,
    aliases: ["Constraint math"],
  });
  return [
    monaco.languages.setLanguageConfiguration(CONSTRAINT_YAML_LANGUAGE, yamlConfiguration),
    monaco.languages.setMonarchTokensProvider(CONSTRAINT_YAML_LANGUAGE, constraintYamlTokens),
    monaco.languages.setLanguageConfiguration(CONSTRAINT_MATH_LANGUAGE, constraintMathConfiguration),
    monaco.languages.setMonarchTokensProvider(CONSTRAINT_MATH_LANGUAGE, constraintMathTokens),
    monaco.languages.setLanguageConfiguration(PETRI_NET_IR_LANGUAGE, yamlConfiguration),
    monaco.languages.setMonarchTokensProvider(PETRI_NET_IR_LANGUAGE, tokenizer),
    monaco.languages.registerCompletionItemProvider(PETRI_NET_IR_LANGUAGE, completionProvider(monaco)),
  ];
}
