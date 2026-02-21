import React from "react";
import ReactDOM from "react-dom";
import { ModalProvider } from "react-modal-hook";

import { ComparisonTypes, Operation, OperationTypes } from "./types";
import { ErrorBoundary } from "../ErrorBoundary";
import { OutputMetricsGrid } from "./OutputMetricsGrid";

const noop = () => {};
const operations: Operation[] = [
  {
    op: OperationTypes.filter,
    field: "age",
    comparison: ComparisonTypes.eq,
    value: 15,
  },
  { op: OperationTypes.count },
];
const metrics = { metricName: operations };

it("renders without crashing", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <ModalProvider>
      <ErrorBoundary>
        <OutputMetricsGrid
          metrics={metrics}
          onOutputMetricsModalSave={noop}
          readonly={false}
        />
      </ErrorBoundary>
    </ModalProvider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
