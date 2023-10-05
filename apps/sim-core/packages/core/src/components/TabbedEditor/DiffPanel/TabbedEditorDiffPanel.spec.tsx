import React from "react";
import ReactDOM from "react-dom";

// TODO: figure out how to mock editor instances and diff models
// import { TabbedEditorDiffPanel } from "./TabbedEditorDiffPanel";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    // <TabbedEditorDiffPanel />
    <div />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
