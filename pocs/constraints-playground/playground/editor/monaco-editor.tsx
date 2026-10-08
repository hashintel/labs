import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type LineDecoration, type TextRange, toModelDecorations, toRangeDecorations } from "./line-decorations";
import { monaco } from "./monaco";
import { SWISS_THEME } from "./swiss-theme";

import type { editor } from "monaco-editor/editor/editor.api.js";
import type { CONSTRAINT_MATH_LANGUAGE, CONSTRAINT_YAML_LANGUAGE, PETRI_NET_IR_LANGUAGE } from "./petri-net-ir-language";

import "./monaco-editor.css";

/** A diagnostic shown as a squiggle on one line of the text. */
export type EditorMarker = {
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
};

/** The editor instance a parent can reach through `editorRef`, to reveal a line say. */
export type CodeEditor = editor.IStandaloneCodeEditor;

type MonacoEditorProps = {
  /** Names the model; one model per path, kept while the editor remounts. */
  path: string;
  /** The IR's grammar, the constraint file's, or the Math view's. */
  language: typeof PETRI_NET_IR_LANGUAGE | typeof CONSTRAINT_YAML_LANGUAGE | typeof CONSTRAINT_MATH_LANGUAGE;
  value: string;
  readOnly?: boolean;
  /** No line numbers or folds and a tighter pad, for a short text such as one formula. */
  plain?: boolean;
  /** Overrides the pad above and below the text of a plain editor, so two stacked editors can meet with no gap. */
  padding?: { top: number; bottom: number };
  /** Called with the height the whole text needs, wrapped lines and pads included, each time it changes. */
  onContentHeight?: (height: number) => void;
  /** Pins the enclosing entries at the top while scrolling; from indentation, as the IR has no symbols. */
  stickyScroll?: boolean;
  onChange?: (value: string) => void;
  decorations?: readonly LineDecoration[];
  /** Spans of the text lit by a hover on the same condition in another view. */
  linkedRanges?: readonly TextRange[];
  /** Diagnostics shown as markers over the text. */
  markers?: readonly EditorMarker[];
  /** The line under the pointer, `null` when it leaves the text. */
  onHoverLine?: (line: number | null) => void;
  /** Holds the editor while it is mounted, for imperative calls from event handlers. */
  editorRef?: React.RefObject<CodeEditor | null>;
};

const OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  theme: SWISS_THEME,
  automaticLayout: true,
  fontFamily: "JetBrains Mono Variable",
  fontSize: 12,
  lineHeight: 18,
  minimap: { enabled: false },
  wordWrap: "on",
  wrappingIndent: "indent",
  // Break at spaces and operators, never inside `count(...)` or `fired(...)`.
  wordWrapBreakBeforeCharacters: "",
  wordWrapBreakAfterCharacters: " )+-*/<>=:,;|&",
  scrollBeyondLastLine: false,
  renderLineHighlight: "none",
  lineNumbersMinChars: 3,
  lineDecorationsWidth: 6,
  glyphMargin: false,
  folding: true,
  // Expanded chevrons rest faint and come up while the pointer is over the gutter; see monaco-editor.css.
  showFoldingControls: "mouseover",
  wordBasedSuggestions: "off",
  quickSuggestions: { other: true, comments: false, strings: true },
  suggest: { showStatusBar: false, preview: false },
  fixedOverflowWidgets: true,
  padding: { top: 8, bottom: 8 },
  // An editor that shows all its text hands the wheel on, so the pane around it scrolls.
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, alwaysConsumeMouseWheel: false },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  occurrencesHighlight: "off",
  selectionHighlight: false,
  matchBrackets: "never",
  guides: { indentation: true },
  tabSize: 2,
  insertSpaces: true,
  editContext: false,
};

const NO_DECORATIONS: readonly LineDecoration[] = [];
const NO_RANGES: readonly TextRange[] = [];
const NO_MARKERS: readonly EditorMarker[] = [];

/** Each path's scroll, cursor and folds, kept while its editor is disposed, as when a view is hidden. */
const viewStates = new Map<string, editor.ICodeEditorViewState | null>();

function uriOf(path: string) {
  return monaco.Uri.from({ scheme: "playground", path: `/${path}` });
}

/** The model for a path, created on first use with the value it will show. */
function modelFor(path: string, language: string, value: string): editor.ITextModel {
  const uri = uriOf(path);
  const existing = monaco.editor.getModel(uri);
  if (existing !== null) {
    monaco.editor.setModelLanguage(existing, language);
    return existing;
  }
  return monaco.editor.createModel(value, language, uri);
}

/** Replaces the model's text as one edit, so undo keeps working across a rewrite from outside. */
function setModelValue(model: editor.ITextModel, value: string): void {
  if (model.getValue() === value) {
    return;
  }
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text: value }],
    () => null,
  );
}

type Instance = {
  editor: editor.IStandaloneCodeEditor;
  decorations: editor.IEditorDecorationsCollection;
  linked: editor.IEditorDecorationsCollection;
};

/**
 * A Monaco editor over one model: controlled by `value`, reporting edits
 * through `onChange` and the hovered line through `onHoverLine`, showing the
 * decorations and markers it is given. Its effects each sync one thing React
 * does not own: the instance, the model's text, the decorations, the markers.
 */
export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  path,
  language,
  value,
  readOnly = false,
  plain = false,
  padding,
  onContentHeight,
  stickyScroll = false,
  onChange,
  decorations = NO_DECORATIONS,
  linkedRanges = NO_RANGES,
  markers = NO_MARKERS,
  onHoverLine,
  editorRef,
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const instanceRef = useRef<Instance | null>(null);
  // Monaco's listeners call these with the latest props, without recreating the editor. Monaco
  // also reports the text the value effect writes, and a text equal to `value` is no edit.
  const emitChange = useEffectEvent((text: string) => {
    if (text !== value) {
      onChange?.(text);
    }
  });
  const emitHoverLine = useEffectEvent((line: number | null) => onHoverLine?.(line));
  const emitContentHeight = useEffectEvent((height: number) => onContentHeight?.(height));

  useEffect(() => {
    if (container === null) {
      return;
    }
    // The value is read once, to create the model; later values flow through the effect below.
    const instance = monaco.editor.create(container, {
      ...OPTIONS,
      model: modelFor(path, language, value),
      readOnly,
      domReadOnly: readOnly,
      ...(plain
        ? { lineNumbers: "off" as const, folding: false, lineDecorationsWidth: 12, padding: padding ?? { top: 4, bottom: 4 } }
        : {}),
      stickyScroll: { enabled: stickyScroll, defaultModel: "indentationModel", maxLineCount: 4 },
    });
    instance.restoreViewState(viewStates.get(path) ?? null);
    instanceRef.current = {
      editor: instance,
      decorations: instance.createDecorationsCollection(),
      linked: instance.createDecorationsCollection(),
    };
    if (editorRef !== undefined) {
      editorRef.current = instance;
    }
    let hoveredLine: number | null = null;
    function hover(line: number | null) {
      if (line !== hoveredLine) {
        hoveredLine = line;
        emitHoverLine(line);
      }
    }
    const subscriptions = [
      instance.onDidChangeModelContent(() => emitChange(instance.getValue())),
      instance.onMouseMove((event) => hover(event.target.position?.lineNumber ?? null)),
      instance.onMouseLeave(() => hover(null)),
      instance.onDidContentSizeChange((event) => emitContentHeight(event.contentHeight)),
    ];
    emitContentHeight(instance.getContentHeight());
    return () => {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      hover(null);
      viewStates.set(path, instance.saveViewState());
      instance.dispose();
      instanceRef.current = null;
      if (editorRef !== undefined) {
        editorRef.current = null;
      }
    };
  }, [container, path, language, readOnly, plain, padding?.top, padding?.bottom, stickyScroll, editorRef]);

  useEffect(() => {
    const model = monaco.editor.getModel(uriOf(path));
    if (model !== null) {
      setModelValue(model, value);
    }
  }, [path, value]);

  // The instance effect's dependencies too, so the decorations land on each new editor.
  useEffect(() => {
    instanceRef.current?.decorations.set(toModelDecorations(decorations));
  }, [decorations, container, path, language, readOnly, plain, padding?.top, padding?.bottom, stickyScroll]);

  useEffect(() => {
    instanceRef.current?.linked.set(toRangeDecorations(linkedRanges));
  }, [linkedRanges, container, path, language, readOnly, plain, padding?.top, padding?.bottom, stickyScroll]);

  useEffect(() => {
    const model = monaco.editor.getModel(uriOf(path));
    if (model === null) {
      return;
    }
    monaco.editor.setModelMarkers(
      model,
      "playground",
      markers.map((marker) => ({
        startLineNumber: marker.line,
        startColumn: 1,
        endLineNumber: marker.line,
        endColumn: model.getLineMaxColumn(Math.min(marker.line, model.getLineCount())),
        message: marker.message,
        severity:
          marker.severity === "error"
            ? monaco.MarkerSeverity.Error
            : marker.severity === "warning"
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Info,
      })),
    );
    return () => monaco.editor.setModelMarkers(model, "playground", []);
  }, [path, markers, value]);

  return <div className="monaco-host" ref={setContainer} />;
};
