import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";

import { ComparisonTypes, Operation, OperationTypes } from "./types";
import { ErrorBoundary } from "../ErrorBoundary";
import { OutputMetricsGrid } from "./OutputMetricsGrid";
import { mockProject } from "../../features/project/mocks";
import { setProjectWithMeta } from "../../features/actions";
import { store } from "../../features/store";

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

  store.dispatch(setProjectWithMeta(mockProject));

  ReactDOM.render(
    <Provider store={store}>
      <ModalProvider>
        <ErrorBoundary>
          <OutputMetricsGrid
            metrics={metrics}
            onOutputMetricsModalSave={noop}
            readonly={false}
          />
        </ErrorBoundary>
      </ModalProvider>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
