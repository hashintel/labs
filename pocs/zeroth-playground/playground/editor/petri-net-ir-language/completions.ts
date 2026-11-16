/**
 * What the IR language offers at a cursor: the keys a nesting level takes,
 * the values a key takes, and the places, colours and dynamics declared
 * above the cursor where a key names one. Pure over the text, so it is
 * tested without an editor. The key tables are typed by the schema's types,
 * so a key added to or dropped from the IR fails the type check here.
 */

import type { PetriNetIr, PetriNetIrArc, PetriNetIrPlace, PetriNetIrTransition } from "../../../compiler";

export type Completion = {
  label: string;
  insertText: string;
  kind: "key" | "value" | "name";
  detail?: string;
};

export type CursorContext = {
  /** The path of the entry the cursor's line belongs to, `["transitions", "Go"]` for a line under Go. */
  parentPath: string[];
  /** The key on the cursor's line when the cursor sits after its colon. */
  valueOf: string | null;
  places: string[];
  colours: string[];
  dynamics: string[];
};

const KEY_LINE = /^( *)(?:- )?([A-Za-z_$][\w-]*):(?: (.*)|$)/u;

const SECTION_KEYS: Record<keyof PetriNetIr, string> = {
  name: "The net's name, an identifier the module is named from",
  description: "Display text",
  kind: "plain, stochastic or mixed",
  colours: "Token colours, each with its attributes",
  dynamics: "Differential equations, each with the colour it moves",
  places: "Each place; a bare key is a plain unbounded place",
  marking: "The tokens each place starts with",
  transitions: "Each transition, in sweep order",
};

const PLACE_KEYS: Record<keyof NonNullable<PetriNetIrPlace>, string> = {
  capacity: "Maximum tokens the place holds",
  colour: "The colour of the tokens it holds",
  dynamics: "The equation that moves its tokens between steps",
};

const TRANSITION_KEYS: Record<keyof PetriNetIrTransition, string> = {
  inputs: "Input arcs keyed by place, in binding order",
  outputs: "Output arcs keyed by place",
  guard: "A predicate over the input tokens, as code",
  rate: "Mean firings per time unit: a number, or code over the tokens",
  kernel: "Code writing the produced tokens' attributes",
  controllable: "The firing is a controller's choice",
};

const ARC_KEYS: Record<keyof NonNullable<PetriNetIrArc>, string> = {
  weight: "Tokens the arc moves; absent means one",
  kind: "read needs the tokens and leaves them; inhibitor needs fewer",
};

const DYNAMICS_KEYS: Record<keyof NonNullable<PetriNetIr["dynamics"]>[string], string> = {
  colour: "The colour whose tokens it moves",
  code: "return tokens.map((token) => ({ attribute: derivative }))",
};

const ATTRIBUTE_TYPES = ["real", "integer", "boolean", "uuid", "string"];

function keys(record: Record<string, string>): Completion[] {
  return Object.entries(record).map(([label, detail]) => ({
    label,
    insertText: `${label}: `,
    kind: "key",
    detail,
  }));
}

function values(labels: readonly string[]): Completion[] {
  return labels.map((label) => ({ label, insertText: label, kind: "value" }));
}

function names(labels: readonly string[], detail: string): Completion[] {
  return labels.map((label) => ({ label, insertText: `${label}:`, kind: "name", detail }));
}

/** The context of the cursor from the lines above it and the line it is on. */
export function cursorContext(text: string, lineNumber: number, column: number): CursorContext {
  const lines = text.split("\n");
  const current = lines[lineNumber - 1] ?? "";
  const beforeCursor = current.slice(0, column - 1);
  const indent = /^ */u.exec(beforeCursor)?.[0].length ?? 0;
  const stack: { indent: number; path: string[] }[] = [];
  const places: string[] = [];
  const colours: string[] = [];
  const dynamics: string[] = [];
  let blockIndent: number | null = null;
  for (const line of lines.slice(0, lineNumber - 1)) {
    if (blockIndent !== null) {
      const lineIndent = /^ */u.exec(line)?.[0].length ?? 0;
      if (line.trim() === "" || lineIndent > blockIndent) {
        continue;
      }
      blockIndent = null;
    }
    const match = KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }
    const lineIndent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    if (/^[|>][-+]?$/u.test(match[3] ?? "")) {
      blockIndent = lineIndent;
    }
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= lineIndent) {
      stack.pop();
    }
    const path = [...(stack[stack.length - 1]?.path ?? []), key];
    stack.push({ indent: lineIndent, path });
    if (path.length === 2) {
      const section = path[0];
      if (section === "places") {
        places.push(key);
      } else if (section === "colours") {
        colours.push(key);
      } else if (section === "dynamics") {
        dynamics.push(key);
      }
    }
  }
  while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? -1) >= indent) {
    stack.pop();
  }
  const parentPath = stack[stack.length - 1]?.path ?? [];
  const ownKey = /^ *(?:- )?([A-Za-z_$][\w-]*):(?: |$)/u.exec(beforeCursor)?.[1];
  return {
    parentPath,
    valueOf: ownKey ?? null,
    places,
    colours,
    dynamics,
  };
}

function valueCompletions(path: string[], context: CursorContext): Completion[] {
  const [section, , field, arcPlace, arcField] = path;
  if (path.length === 1 && section === "kind") {
    return values(["plain", "stochastic", "mixed"]);
  }
  if (section === "places" && path.length === 3) {
    if (field === "colour") {
      return values(context.colours);
    }
    if (field === "dynamics") {
      return values(context.dynamics);
    }
  }
  if (section === "dynamics" && path.length === 3 && field === "colour") {
    return values(context.colours);
  }
  if (section === "colours" && path.length === 3) {
    return values(ATTRIBUTE_TYPES);
  }
  if (section === "transitions" && path.length === 3 && field === "controllable") {
    return values(["true"]);
  }
  if (
    section === "transitions" &&
    path.length === 5 &&
    field === "inputs" &&
    arcPlace !== undefined &&
    arcField === "kind"
  ) {
    return values(["read", "inhibitor"]);
  }
  return [];
}

function keyCompletions(context: CursorContext): Completion[] {
  const { parentPath, places } = context;
  const [section, , field] = parentPath;
  switch (parentPath.length) {
    case 0:
      return keys(SECTION_KEYS);
    case 1:
      if (section === "marking") {
        return names(places, "A place declared above");
      }
      return [];
    case 2:
      if (section === "places") {
        return keys(PLACE_KEYS);
      }
      if (section === "transitions") {
        return keys(TRANSITION_KEYS);
      }
      if (section === "dynamics") {
        return keys(DYNAMICS_KEYS);
      }
      return [];
    case 3:
      if (section === "transitions" && (field === "inputs" || field === "outputs")) {
        return names(places, "A place declared above");
      }
      if (section === "colours") {
        return [{ label: "enum", insertText: "enum:", kind: "key", detail: "A closed set of string values" }];
      }
      return [];
    case 4:
      if (section === "transitions" && field === "inputs") {
        return keys(ARC_KEYS);
      }
      if (section === "transitions" && field === "outputs") {
        return keys({ weight: ARC_KEYS.weight });
      }
      return [];
    default:
      return [];
  }
}

/** The completions at a cursor: values when it sits after a key's colon, keys or names otherwise. */
export function completionsAt(text: string, lineNumber: number, column: number): Completion[] {
  const context = cursorContext(text, lineNumber, column);
  return context.valueOf === null
    ? keyCompletions(context)
    : valueCompletions([...context.parentPath, context.valueOf], context);
}
