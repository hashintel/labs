import React from "react";
import { render } from "@testing-library/react";

import { ErrorBoundary } from "../../ErrorBoundary";
import { ModalPlots } from "./ModalPlots";

it("renders without crashing", () => {
  render(
    <ErrorBoundary>
      <ModalPlots
        onClose={() => {}}
        onSave={() => {}}
        outputs={{ hello: [{ op: "get", field: "bla" }] }}
      />
    </ErrorBoundary>,
  );
});
