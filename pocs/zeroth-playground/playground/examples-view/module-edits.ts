/**
 * Hand edits to the emitted module: whether the module editor takes edits,
 * and the text of each file edited away from what the compiler wrote. The
 * edits hold against one compilation only, so a new compilation drops them
 * and leaves the toggle as it was.
 */
export type ModuleEdits = {
  editing: boolean;
  /** The edited text by file path; a file left as compiled has no entry. */
  texts: Readonly<Record<string, string>>;
};

export const NO_EDITS: ModuleEdits = { editing: false, texts: {} };

export function toggleEditing(edits: ModuleEdits): ModuleEdits {
  return { ...edits, editing: !edits.editing };
}

/** The edits once `path` reads `text`: an edit back to the compiled text drops the file's entry. */
export function editFile(edits: ModuleEdits, path: string, text: string, compiled: string): ModuleEdits {
  const { [path]: _previous, ...others } = edits.texts;
  return { ...edits, texts: text === compiled ? others : { ...others, [path]: text } };
}

/** What a file shows: its edit, else what the compiler wrote. */
export function shownText(edits: ModuleEdits, path: string, compiled: string): string {
  return edits.texts[path] ?? compiled;
}

export function isEdited(edits: ModuleEdits, path?: string): boolean {
  return path === undefined ? Object.keys(edits.texts).length > 0 : path in edits.texts;
}

/** The edits after the compiler writes the module again: every text dropped, the toggle kept. */
export function recompiled(edits: ModuleEdits): ModuleEdits {
  return isEdited(edits) ? { ...edits, texts: {} } : edits;
}
