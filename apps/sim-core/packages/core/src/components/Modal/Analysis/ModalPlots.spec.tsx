import React from "react";
import ReactDOM from "react-dom";

import { ErrorBoundary } from "../../ErrorBoundary";
import { ModalPlots } from "./ModalPlots";

it("renders without crashing", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <ErrorBoundary>
      <ModalPlots
        onClose={() => {}}
        onSave={() => {}}
        outputs={{ hello: [{ op: "get", field: "bla" }] }}
      />
    </ErrorBoundary>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
