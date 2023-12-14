import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";

import { ButtonCallToAction } from "./ButtonCallToAction";
import { ErrorBoundary } from "../ErrorBoundary";
import { mockProject } from "../../features/project/mocks";
import { setProjectWithMeta } from "../../features/actions";
import { store } from "../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");

  //@ts-expect-error Redux types need to be repaired.
  store.dispatch(setProjectWithMeta(mockProject));

  ReactDOM.render(
    <Provider store={store}>
      <ModalProvider>
        <ErrorBoundary>
          <ButtonCallToAction>
            <h1>Testing</h1>
          </ButtonCallToAction>
        </ErrorBoundary>
      </ModalProvider>
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
