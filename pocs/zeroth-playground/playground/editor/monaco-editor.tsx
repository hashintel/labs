import { useEffect, useEffectEvent, useRef, useState } from "react";

import { type LineDecoration, toModelDecorations } from "./line-decorations";
import { monaco } from "./monaco";
import { bindTrace, unbindTrace } from "./provenance-hover";
import { SWISS_THEME } from "./swiss-theme";

import type { Trace } from "../../compiler";
import type { editor } from "monaco-editor/editor/editor.api.js";
import type { PETRI_NET_IR_LANGUAGE } from "./petri-net-ir-language";

import "./monaco-editor.css";

/** The editor instance a parent can reach through `editorRef`, to reveal a line say. */
export type CodeEditor = editor.IStandaloneCodeEditor;

type MonacoEditorProps = {
  /** Names the model; one model per path, kept while the editor remounts. */
  path: string;
  /** The IR's grammar, or Monaco's Python. */
  language: typeof PETRI_NET_IR_LANGUAGE | "python";
  value: string;
  readOnly?: boolean;
  /** Pins the enclosing entries at the top while scrolling; from indentation, as the IR has no symbols. */
  stickyScroll?: boolean;
  onChange?: (value: string) => void;
  /** The trace over `value`, read by the hover; none means no hover. */
  trace?: Trace;
  decorations?: readonly LineDecoration[];
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
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
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
};

/**
 * A Monaco editor over one model: controlled by `value`, reporting edits
 * through `onChange` and the hovered line through `onHoverLine`, showing the
 * decorations it is given, with the trace bound for the hover card. Its
 * effects each sync one thing React does not own: the instance, the model's
 * text, the decorations, the trace the hover reads.
 */
export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  path,
  language,
  value,
  readOnly = false,
  stickyScroll = false,
  onChange,
  trace,
  decorations = NO_DECORATIONS,
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
      stickyScroll: { enabled: stickyScroll, defaultModel: "indentationModel", maxLineCount: 4 },
    });
    instance.restoreViewState(viewStates.get(path) ?? null);
    instanceRef.current = { editor: instance, decorations: instance.createDecorationsCollection() };
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
    ];
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
  }, [container, path, language, readOnly, stickyScroll, editorRef]);

  useEffect(() => {
    const model = monaco.editor.getModel(uriOf(path));
    if (model !== null) {
      setModelValue(model, value);
    }
  }, [path, value]);

  // The instance effect's dependencies too, so the decorations land on each new editor.
  useEffect(() => {
    instanceRef.current?.decorations.set(toModelDecorations(decorations));
  }, [decorations, container, path, language, readOnly, stickyScroll]);

  useEffect(() => {
    const key = uriOf(path).toString();
    if (trace === undefined) {
      unbindTrace(key);
      return;
    }
    bindTrace(key, { trace, text: value });
    return () => unbindTrace(key);
  }, [path, trace, value]);

  return <div className="monaco-host" ref={setContainer} />;
};
