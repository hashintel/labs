import { languages } from "monaco-editor";

/**
 * HASH simulation API completions for Python behaviors.
 * Provides autocomplete for the `state`, `context`, and `hstd`/`hash_stdlib` objects.
 */
export function configurePythonCompletions() {
  languages.registerCompletionItemProvider("python", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const lineContent = model.getLineContent(position.lineNumber);
      const textBefore = lineContent.substring(0, position.column - 1);

      const suggestions: languages.CompletionItem[] = [];

      if (textBefore.endsWith("state.")) {
        suggestions.push(
          ...stateMethodSuggestions(range, languages.CompletionItemKind.Method),
        );
      } else if (textBefore.endsWith("context.")) {
        suggestions.push(
          ...contextMethodSuggestions(
            range,
            languages.CompletionItemKind.Method,
          ),
        );
      } else if (
        textBefore.endsWith("hstd.") ||
        textBefore.endsWith("hash_stdlib.")
      ) {
        suggestions.push(
          ...hstdSuggestions(range, languages.CompletionItemKind.Function),
        );
      } else {
        suggestions.push(
          ...topLevelSuggestions(range, languages.CompletionItemKind.Variable),
        );
      }

      return { suggestions };
    },
  });
}

function stateMethodSuggestions(
  range: languages.CompletionItem["range"],
  kind: languages.CompletionItemKind,
): languages.CompletionItem[] {
  return [
    {
      label: "get",
      kind,
      insertText: 'get("${1:field}")',
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Return the value of a field in the agent's state",
      range,
    },
    {
      label: "set",
      kind,
      insertText: 'set("${1:field}", ${2:value})',
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Set the value of a field in the agent's state",
      range,
    },
    {
      label: "modify",
      kind,
      insertText: 'modify("${1:field}", ${2:lambda val: val})',
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation:
        "Replace the value of a field by applying a function to the current value",
      range,
    },
    {
      label: "add_message",
      kind,
      insertText: 'add_message("${1:to}", "${2:type}", ${3:data})',
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: 'Append a message formatted as { to, type, data }',
      range,
    },
    {
      label: "behavior_index",
      kind,
      insertText: "behavior_index()",
      documentation:
        "Return the index of the current behavior in the agent's chain",
      range,
    },
  ];
}

function contextMethodSuggestions(
  range: languages.CompletionItem["range"],
  kind: languages.CompletionItemKind,
): languages.CompletionItem[] {
  return [
    {
      label: "neighbors",
      kind,
      insertText: "neighbors()",
      documentation: "Return an array of all neighbors visible to the agent",
      range,
    },
    {
      label: "globals",
      kind,
      insertText: "globals()",
      documentation:
        "Return all global variables defined in globals.json",
      range,
    },
    {
      label: "messages",
      kind,
      insertText: "messages()",
      documentation:
        "Return all messages sent to the agent in the previous step",
      range,
    },
    {
      label: "data",
      kind,
      insertText: "data()",
      documentation:
        "Return all datasets imported to the simulation",
      range,
    },
    {
      label: "step",
      kind,
      insertText: "step()",
      documentation: "Return the current step number of the simulation",
      range,
    },
  ];
}

function hstdSuggestions(
  range: languages.CompletionItem["range"],
  kind: languages.CompletionItemKind,
): languages.CompletionItem[] {
  return [
    {
      label: "generate_agent_id",
      kind,
      insertText: "generate_agent_id()",
      documentation: "Generate a unique agent ID",
      range,
    },
    {
      label: "distance_between",
      kind,
      insertText: "distance_between(${1:agent_a}, ${2:agent_b})",
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Calculate the distance between two agents",
      range,
    },
    {
      label: "normalize_vector",
      kind,
      insertText: "normalize_vector(${1:vector})",
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Normalize a vector to unit length",
      range,
    },
    {
      label: "init.scatter",
      kind,
      insertText: "init.scatter(${1:count}, ${2:topology})",
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Scatter agents randomly across the topology",
      range,
    },
    {
      label: "init.grid",
      kind,
      insertText: "init.grid(${1:topology})",
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Create agents on a grid layout",
      range,
    },
    {
      label: "init.stack",
      kind,
      insertText: "init.stack(${1:count}, ${2:template})",
      insertTextRules:
        languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: "Create a stack of agents from a template",
      range,
    },
  ];
}

function topLevelSuggestions(
  range: languages.CompletionItem["range"],
  kind: languages.CompletionItemKind,
): languages.CompletionItem[] {
  return [
    {
      label: "state",
      kind,
      insertText: "state",
      documentation: "The current agent's mutable state object",
      range,
    },
    {
      label: "context",
      kind,
      insertText: "context",
      documentation:
        "Read-only context providing neighbors, globals, messages, and data",
      range,
    },
    {
      label: "hstd",
      kind,
      insertText: "hstd",
      documentation: "HASH standard library functions",
      range,
    },
    {
      label: "hash_stdlib",
      kind,
      insertText: "hash_stdlib",
      documentation: "HASH standard library functions (alias)",
      range,
    },
  ];
}
