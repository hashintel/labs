import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { ErrorBoundary } from "../../ErrorBoundary";
import { ModalPlots } from "./ModalPlots";
import { mockProject } from "../../../features/project/mocks";
import { setProjectWithMeta } from "../../../features/actions";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");

  store.dispatch(setProjectWithMeta(mockProject));

  ReactDOM.render(
    <Provider store={store}>
      <ErrorBoundary>
        <ModalPlots
          onClose={() => {}}
          onSave={() => {}}
          outputs={{ hello: [{ op: "get", field: "bla" }] }}
        />
      </ErrorBoundary>
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
