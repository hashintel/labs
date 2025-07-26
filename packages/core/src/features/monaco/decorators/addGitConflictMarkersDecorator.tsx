import lineColumn from "line-column";
import { IDisposable, IRange, Range, editor, languages } from "monaco-editor";
import { remove } from "lodash";

enum ConflictMarkerTokenTypes {
  "StartHeading" = "StartHeading",
  "Start" = "Start",
  "Divider" = "Divider",
  "End" = "End",
  "EndHeading" = "EndHeading",
}

export interface Conflict {
  range: Range;
  options: editor.IModelDecorationOptions;
}

interface LineColumnInfo {
  line: number;
  col: number;
}

const getResolvedCodeLensesKey = (range: Range) =>
  `${range.startLineNumber}:${range.startColumn}`;

const executeEditsWithUndoStops = (
  editorInstance: editor.ICodeEditor,
  ...args: Parameters<editor.ICodeEditor["executeEdits"]>
) => {
  editorInstance.pushUndoStop();
  const res = editorInstance.executeEdits(...args);
  editorInstance.pushUndoStop();
  return res;
};

// CodeLens support
const resolvedCodeLenses: string[] = [];
let codeLensProvider: IDisposable | null;
const acceptCurrentChangeHandler = (
  _context: string,
  editorInstance: editor.ICodeEditor,
  headingConflict: Range,
  startConflict: Range,
  divider: Range,
  _endConflict: Range,
  endHeadingConflict: Range,
) => {
  const headingRange = new Range(
    headingConflict.startLineNumber,
    headingConflict.startColumn,
    startConflict.startLineNumber,
    startConflict.startColumn,
  );
  const range = new Range(
    divider.startLineNumber,
    divider.startColumn,
    endHeadingConflict.endLineNumber + 1,
    1,
  );
  executeEditsWithUndoStops(editorInstance, "", [
    { forceMoveMarkers: true, range: headingRange, text: null },
    { forceMoveMarkers: true, range, text: null },
  ]);
  resolvedCodeLenses.push(getResolvedCodeLensesKey(headingConflict));
  cleanupPreviousCodeLensProvider();
};

const acceptIncomingChangeHandler = (
  _context: string,
  editorInstance: editor.ICodeEditor,
  headingConflict: Range,
  _startConflict: Range,
  _divider: Range,
  endConflict: Range,
  endHeadingConflict: Range,
) => {
  const headingRange = new Range(
    headingConflict.startLineNumber,
    headingConflict.startColumn,
    endConflict.startLineNumber,
    endConflict.startColumn,
  );
  const range = new Range(
    endHeadingConflict.startLineNumber,
    endHeadingConflict.startColumn,
    endHeadingConflict.endLineNumber + 1,
    1,
  );
  executeEditsWithUndoStops(editorInstance, "", [
    { forceMoveMarkers: true, range: headingRange, text: null },
    { forceMoveMarkers: true, range, text: null },
  ]);
  resolvedCodeLenses.push(getResolvedCodeLensesKey(headingConflict));
  cleanupPreviousCodeLensProvider();
};

const acceptBothChangesHandler = (
  _context: string,
  editorInstance: editor.ICodeEditor,
  headingConflict: Range,
  startConflict: Range,
  divider: Range,
  _endConflict: Range,
  endHeadingConflict: Range,
) => {
  const headingRange = new Range(
    headingConflict.startLineNumber,
    headingConflict.startColumn,
    startConflict.startLineNumber,
    startConflict.startColumn,
  );
  const dividerRange = new Range(
    divider.startLineNumber,
    divider.startColumn,
    divider.endLineNumber + 1,
    1,
  );
  const endHeadingRange = new Range(
    endHeadingConflict.startLineNumber,
    endHeadingConflict.startColumn,
    endHeadingConflict.endLineNumber + 1,
    1,
  );
  executeEditsWithUndoStops(editorInstance, "", [
    { forceMoveMarkers: true, range: headingRange, text: null },
    { forceMoveMarkers: true, range: dividerRange, text: null },
    { forceMoveMarkers: true, range: endHeadingRange, text: null },
  ]);
  resolvedCodeLenses.push(getResolvedCodeLensesKey(headingConflict));
  cleanupPreviousCodeLensProvider();
};

let acceptCurrentChange: IDisposable | null = null;
let acceptIncomingChange: IDisposable | null = null;
let acceptBothChanges: IDisposable | null = null;
const registerCommands = () => {
  acceptCurrentChange = editor.registerCommand(
    "acceptCurrentChange",
    acceptCurrentChangeHandler,
  );
  acceptIncomingChange = editor.registerCommand(
    "acceptIncomingChange",
    acceptIncomingChangeHandler,
  );
  acceptBothChanges = editor.registerCommand(
    "acceptBothChanges",
    acceptBothChangesHandler,
  );
};

const filterByClassName = (
  conflicts: Conflict[],
  expected: ConflictMarkerTokenTypes,
) =>
  conflicts.filter(
    (conflict) =>
      conflict.options.className ===
      `HashCoreEditor__ConflictMarkers__${expected}`,
  );

const getLenses = (
  conflicts: Conflict[],
  resolvedCodeLenses: string[],
  editorInstance: editor.ICodeEditor,
) => {
  const result: {
    range: IRange;
    id: string;
    command: {
      id: any;
      title: string;
      arguments: (Range | editor.ICodeEditor)[];
    };
  }[] = [];

  const headingConflicts = filterByClassName(
    conflicts,
    ConflictMarkerTokenTypes.StartHeading,
  );
  const startBlockConflicts = filterByClassName(
    conflicts,
    ConflictMarkerTokenTypes.Start,
  );
  const divider = filterByClassName(
    conflicts,
    ConflictMarkerTokenTypes.Divider,
  );
  const endBlockConflicts = filterByClassName(
    conflicts,
    ConflictMarkerTokenTypes.End,
  );
  const endHeadingConflicts = filterByClassName(
    conflicts,
    ConflictMarkerTokenTypes.EndHeading,
  );

  headingConflicts.forEach((conflict: Conflict, index: number) => {
    if (
      resolvedCodeLenses.includes(getResolvedCodeLensesKey(conflict.range)) ||
      conflicts.length === 0
    ) {
      return result;
    }
    const commandArgs = [
      editorInstance,
      conflict.range,
      startBlockConflicts[index].range,
      divider[index].range,
      endBlockConflicts[index].range,
      endHeadingConflicts[index].range,
    ];
    result.push({
      range: conflict.range,
      id: `Accept current change ${getResolvedCodeLensesKey(conflict.range)}`,
      command: {
        id: "acceptCurrentChange",
        title: "Accept current change",
        arguments: commandArgs,
      },
    });
    result.push({
      range: conflict.range,
      id: `Accept incoming change ${getResolvedCodeLensesKey(conflict.range)}`,
      command: {
        id: "acceptIncomingChange",
        title: "Accept incoming change",
        arguments: commandArgs,
      },
    });
    result.push({
      range: conflict.range,
      id: `Accept both changes ${getResolvedCodeLensesKey(conflict.range)}`,
      command: {
        id: "acceptBothChanges",
        title: "Accept both changes",
        arguments: commandArgs,
      },
    });
  });
  return result;
};

const cleanupPreviousCodeLensProvider = () => {
  codeLensProvider?.dispose();
  acceptCurrentChange?.dispose();
  acceptIncomingChange?.dispose();
  acceptBothChanges?.dispose();
};

const cleanupResolvedCodeLenses = () => {
  remove(resolvedCodeLenses, () => true); // we can't simply reassign this because its a constant
};

const registerGitConflictCodeLensProviders = (
  editorInstance: editor.ICodeEditor,
  conflicts: Conflict[],
  currentLanguage: string,
) => {
  cleanupPreviousCodeLensProvider();
  if (conflicts.length === 0) {
    cleanupResolvedCodeLenses();
  }
  registerCommands();
  // only parse the current language
  const lenses = getLenses(conflicts, resolvedCodeLenses, editorInstance);
  codeLensProvider = languages.registerCodeLensProvider(currentLanguage, {
    provideCodeLenses: function (_model, _token) {
      return {
        lenses,
        dispose: () => {},
      };
    },
  });
};

// The following regex matches the following format:
// <<<<<<< HEAD:README.md
// New text that
// can be multiline
// =======
// Old text
// >>>>>>> 77976da35a11db4580b80ae27e8d65caf5208086:README.md
// Try it on https://regex101.com/r/aw03un/1
const GIT_CONFLICT_MARKERS_REGEX =
  /(^<<<<<<< \w+:\w+.+\s)((?:.|\s)*?)\s(=======\s)(^(?:.|\s)*?)(^>>>>>>> \w+:\w+.+\s)/gm;

const getOptions = (
  token: string,
  hoverMessage: string,
): editor.IModelDecorationOptions => ({
  isWholeLine: true,
  className: `HashCoreEditor__ConflictMarkers__${token}`,
  hoverMessage: { value: hoverMessage },
  stickiness:
    token === "divider"
      ? editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      : editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
});

const startHeadingMatcher = (
  conflicts: Conflict[],
  lineData: LineColumnInfo,
  match: string,
) => {
  conflicts.push({
    range: new Range(lineData.line, 1, lineData.line, match.length),
    options: getOptions(
      ConflictMarkerTokenTypes.StartHeading,
      "Code in target",
    ),
  });
};

const startMatcher = (
  conflicts: Conflict[],
  lineData: LineColumnInfo,
  match: string,
) => {
  const lineMatches = match.split("\n");
  conflicts.push({
    range: new Range(
      lineData.line + 1,
      lineData.col,
      lineData.line + lineMatches.length,
      lineMatches[lineMatches.length - 1].length,
    ),
    options: getOptions(ConflictMarkerTokenTypes.Start, "Code in target"),
  });
};

const dividerMatcher = (conflicts: Conflict[]) => {
  const conflictDividerLine =
    conflicts[conflicts.length - 1].range.endLineNumber + 1;
  conflicts.push({
    range: new Range(conflictDividerLine, 1, conflictDividerLine, 8),
    options: getOptions(ConflictMarkerTokenTypes.Divider, ""),
  });
};

const endMatcher = (conflicts: Conflict[], match: string) => {
  const conflictDividerLine =
    conflicts[conflicts.length - 1].range.endLineNumber;
  const startingLineNumber = conflictDividerLine + 1;
  const lineMatches = match.split("\n");
  conflicts.push({
    range: new Range(
      startingLineNumber,
      1,
      startingLineNumber + lineMatches.length - 2,
      lineMatches[lineMatches.length - 2].length + 1,
    ),
    options: getOptions(ConflictMarkerTokenTypes.End, "Suggested change"),
  });
};

const endHeadingMatcher = (conflicts: Conflict[], match: string) => {
  const conflictMarkerEndLine =
    conflicts[conflicts.length - 1].range.endLineNumber;
  conflicts.push({
    range: new Range(
      conflictMarkerEndLine + 1,
      1,
      conflictMarkerEndLine + 1,
      match.length,
    ),
    options: getOptions(
      ConflictMarkerTokenTypes.EndHeading,
      "Suggested change",
    ),
  });
};

export const addGitConflictMarkersDecorator = (
  editorContent?: string,
  editorInstance?: editor.ICodeEditor,
) => {
  if (typeof editorContent !== "string" || !editorInstance) {
    console.error(
      "addGitConflictMarkersDecorator: !editorContent || !editorInstance, exiting",
    );
    return;
  }
  const currentLanguage = editorInstance?.getModel()?.getModeId();
  if (!currentLanguage) {
    console.error(
      "addGitConflictMarkersDecorator: could not detect current language",
    );
    return;
  }
  const editorContentAsLineColumn = lineColumn(editorContent);
  let currentRegexResult: RegExpExecArray | null;
  const conflicts: Conflict[] = [];
  while (
    (currentRegexResult = GIT_CONFLICT_MARKERS_REGEX.exec(editorContent)) !==
    null
  ) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (currentRegexResult.index === GIT_CONFLICT_MARKERS_REGEX.lastIndex) {
      GIT_CONFLICT_MARKERS_REGEX.lastIndex++;
    }
    if (currentRegexResult === null) {
      return;
    }
    const lineData = editorContentAsLineColumn.fromIndex(
      currentRegexResult.index,
    );
    if (lineData === null) {
      console.error("useConflictMarkersDecorator: Could not parse line data");
      return;
    }

    // Match each regular expression group, extract information to generate a Range
    // and finally add them to conflicts
    startHeadingMatcher(conflicts, lineData, currentRegexResult[1]);
    startMatcher(conflicts, lineData, currentRegexResult[2]);
    dividerMatcher(conflicts);
    endMatcher(conflicts, currentRegexResult[4]);
    endHeadingMatcher(conflicts, currentRegexResult[5]);
  }

  registerGitConflictCodeLensProviders(
    editorInstance,
    conflicts,
    currentLanguage,
  );
  return editorInstance.deltaDecorations([], conflicts);
};
