import React from "react";
import { render } from "@testing-library/react";
import { ModalProvider } from "react-modal-hook";

import { ButtonCallToAction } from "./ButtonCallToAction";
import { ErrorBoundary } from "../ErrorBoundary";

it("renders without crashing", () => {
  render(
    <ModalProvider>
      <ErrorBoundary>
        <ButtonCallToAction>
          <h1>Testing</h1>
        </ButtonCallToAction>
      </ErrorBoundary>
    </ModalProvider>,
  );
});
