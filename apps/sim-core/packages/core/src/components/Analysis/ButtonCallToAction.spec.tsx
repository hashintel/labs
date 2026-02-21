import React from "react";
import ReactDOM from "react-dom";
import { ModalProvider } from "react-modal-hook";

import { ButtonCallToAction } from "./ButtonCallToAction";
import { ErrorBoundary } from "../ErrorBoundary";

it("renders without crashing", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <ModalProvider>
      <ErrorBoundary>
        <ButtonCallToAction>
          <h1>Testing</h1>
        </ButtonCallToAction>
      </ErrorBoundary>
    </ModalProvider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
