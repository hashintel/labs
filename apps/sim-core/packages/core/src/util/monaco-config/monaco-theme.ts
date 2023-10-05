import nightOwl from "monaco-themes/themes/Night Owl.json";
import produce, { Draft } from "immer";

import { theme } from "../theme";

export const monacoTheme = produce(nightOwl as any, (draft: Draft<any>) => {
  draft.colors["editor.background"] = theme["editor-background"];
  draft.colors["editor.lineHighlightBackground"] =
    theme["editor-background-highlight"];

  draft.rules.unshift({
    token: "",
    background: draft.colors["editor.background"].slice(1),
  });
});
