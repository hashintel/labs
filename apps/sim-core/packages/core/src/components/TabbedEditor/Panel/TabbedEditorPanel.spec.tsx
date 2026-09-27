import React from "react";
import { render } from "@testing-library/react";

// TODO: figure out how to make monaco-editor play nice with Jest/Babel/TS
// import { TabbedEditorPanel } from "./TabbedEditorPanel";

it("renders without crashing", () => {
  render(
    // <TabbedEditorPanel editorInstance={undefined} textModel={undefined} />,
    <div />,
  );
});
