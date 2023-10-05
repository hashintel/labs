import { editor } from "monaco-editor";

export type EditorInstance = editor.IStandaloneCodeEditor;
export type EditorConstructionsOptions = editor.IStandaloneEditorConstructionOptions;
export type DiffEditorInstance = editor.IStandaloneDiffEditor;
export type ViewState = editor.ICodeEditorViewState;
export type TextModel = editor.ITextModel;
export type DiffEditorModel = editor.IDiffEditorModel;

export type EditorOptions = {
  tabSize?: number;
  readOnly?: boolean;
  wordWrap?: "off" | "on" | "wordWrapColumn" | "bounded";
  wordWrapColumn?: number;
};

export type ModelProperties = {
  value: string;
  path: string;
  language?: string;
  options?: EditorOptions;
  onChange?: (textModel: TextModel) => void;
};

export type EditorTab = {
  key: string;
  title: string;
  onChangeTitle?: (value: string) => void;
  onRemoveTab?: () => void;
  description: string;
  model: ModelProperties;
};
