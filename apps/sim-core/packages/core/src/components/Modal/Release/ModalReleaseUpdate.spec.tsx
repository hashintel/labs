import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { ErrorBoundary } from "../../ErrorBoundary";
import { ModalReleaseUpdate } from "./ModalReleaseUpdate";
import { mockProject } from "../../../features/project/mocks";
import { setProjectWithMeta } from "../../../features/actions";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");

  store.dispatch(setProjectWithMeta(mockProject));

  ReactDOM.render(
    <Provider store={store}>
      <ErrorBoundary>
        <ModalReleaseUpdate onClose={() => {}} />
      </ErrorBoundary>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
