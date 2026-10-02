import type { Monaco } from "./monaco";

export const SWISS_THEME = "swiss";

/**
 * `vs` in the swiss palette: ink on paper, the accent for keywords and numbers, hairlines for the gutter.
 * Monaco's theme takes colour literals, not CSS variables, so the palette of `theme/tokens.css` is hex here.
 */
export function defineSwissTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(SWISS_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "0f1115" },
      { token: "type", foreground: "0f1115" },
      { token: "string", foreground: "565b66" },
      { token: "number", foreground: "0b5fff" },
      { token: "keyword", foreground: "0b5fff" },
      { token: "operators", foreground: "565b66" },
      { token: "comment", foreground: "565b66", fontStyle: "italic" },
      { token: "delimiter", foreground: "565b66" },
      { token: "identifier", foreground: "0f1115" },
      { token: "tag", foreground: "565b66" },
    ],
    colors: {
      "editor.background": "#f7f8f9",
      "editor.foreground": "#0f1115",
      "editorLineNumber.foreground": "#c3c8cf",
      "editorLineNumber.activeForeground": "#565b66",
      "editor.selectionBackground": "#c9dbff",
      "editor.inactiveSelectionBackground": "#dde1e6",
      "editorCursor.foreground": "#0b5fff",
      "editorIndentGuide.background1": "#dde1e6",
      "editorIndentGuide.activeBackground1": "#c3c8cf",
      "editorWidget.background": "#f7f8f9",
      "editorWidget.border": "#c3c8cf",
      // Hover cards read as ink on paper inverted: paper text on ink, code in a grey chip.
      "editorHoverWidget.background": "#0f1115",
      "editorHoverWidget.foreground": "#f7f8f9",
      "editorHoverWidget.border": "#0f1115",
      "editorHoverWidget.statusBarBackground": "#0f1115",
      "textCodeBlock.background": "#2b2f36",
      "textPreformat.foreground": "#f7f8f9",
      "textPreformat.background": "#2b2f36",
      "textLink.foreground": "#7db6ff",
      // Completions: ink on white, a step lighter than the editor, behind a hairline; the
      // selected row a paper-grey step down. Without the foregrounds, `vs` writes the
      // selected row in white, meant for its blue selection.
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#c3c8cf",
      "editorSuggestWidget.foreground": "#0f1115",
      "editorSuggestWidget.selectedBackground": "#e6e9ed",
      "editorSuggestWidget.selectedForeground": "#0f1115",
      "editorSuggestWidget.selectedIconForeground": "#565b66",
      "editorSuggestWidget.highlightForeground": "#0b5fff",
      "editorSuggestWidget.focusHighlightForeground": "#0b5fff",
      "list.hoverBackground": "#f2f4f6",
      "symbolIcon.propertyForeground": "#565b66",
      "symbolIcon.enumeratorMemberForeground": "#565b66",
      "symbolIcon.variableForeground": "#565b66",
      "focusBorder": "#0b5fff",
      "scrollbarSlider.background": "#c3c8cf80",
      "scrollbarSlider.hoverBackground": "#c3c8cf",
      "scrollbarSlider.activeBackground": "#565b66",
      "editorGutter.background": "#f7f8f9",
      "editorStickyScroll.background": "#f7f8f9",
      "editorStickyScroll.border": "#dde1e6",
      "editorStickyScroll.shadow": "#00000000",
      "editorStickyScrollHover.background": "#edeff1",
      "editorGutter.foldingControlForeground": "#565b66",
    },
  });
}
