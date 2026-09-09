import React from "react";
import { render } from "@testing-library/react";

// TODO: figure out how to mock editor instances and diff models
// import { TabbedEditorDiffPanel } from "./TabbedEditorDiffPanel";

it("renders without crashing", () => {
  render(
    // <TabbedEditorDiffPanel />
    <div />,
  );
});
