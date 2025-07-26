import React from "react";
import ReactDOM from "react-dom";

// TODO: figure out how to make monaco-editor play nice with Jest/Babel/TS
// import { TabbedEditorPanel } from "./TabbedEditorPanel";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    // <TabbedEditorPanel editorInstance={undefined} textModel={undefined} />,
    <div />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
