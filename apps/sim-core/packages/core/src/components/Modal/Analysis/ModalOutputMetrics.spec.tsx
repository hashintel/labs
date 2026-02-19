import React from "react";
import ReactDOM from "react-dom";
import { ModalProvider } from "react-modal-hook";
import { render, fireEvent } from "@testing-library/react";

import { ErrorBoundary } from "../../ErrorBoundary";
import { ModalOutputMetrics } from "./ModalOutputMetrics";

const noop = () => {};

it("renders without crashing", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <ModalProvider>
      <ErrorBoundary>
        <ModalOutputMetrics onClose={noop} onSave={noop} />
      </ErrorBoundary>
    </ModalProvider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders the right title and headings (create)", () => {
  const { getByText } = render(
    <ModalProvider>
      <ErrorBoundary>
        <ModalOutputMetrics onClose={noop} onSave={noop} isCreate={true} />
      </ErrorBoundary>
    </ModalProvider>
  );
  expect(getByText("Define new metric")).toBeDefined(); // title
  expect(getByText("METRIC NAME")).toBeDefined(); // first input label
  expect(getByText("OPERATIONS")).toBeDefined(); // dynamic operations label
  expect(getByText("GET HELP")).toBeDefined(); // help link
  expect(getByText("Add additional operation")).toBeDefined(); // Finish? heading
  expect(getByText("Finished?")).toBeDefined(); // Finish? heading
  expect(
    getByText("You'll be able to use your new metric in any plot.")
  ).toBeDefined(); // Finish? span
  expect(getByText("Create new metric")).toBeDefined(); // submit button
});

it("renders the right title and headings (edit)", () => {
  const { getByText } = render(
    <ModalProvider>
      <ErrorBoundary>
        <ModalOutputMetrics onClose={noop} onSave={noop} />
      </ErrorBoundary>
    </ModalProvider>
  );
  expect(getByText("Edit metric")).toBeDefined(); // title
  expect(getByText("METRIC NAME")).toBeDefined(); // first input label
  expect(getByText("OPERATIONS")).toBeDefined(); // dynamic operations label
  expect(getByText("GET HELP")).toBeDefined(); // help link
  expect(getByText("Add additional operation")).toBeDefined(); // Finish? heading
  expect(getByText("Don't want this metric anymore?")).toBeDefined(); // Finish? heading
  expect(getByText("Delete it")).toBeDefined(); // button
  expect(getByText("Save changes")).toBeDefined(); // submit button
});

it("calls onClose when pressing ESCAPE key", () => {
  const mockFn = jest.fn();
  const { baseElement } = render(
    <ModalProvider>
      <ErrorBoundary>
        <ModalOutputMetrics onClose={mockFn} onSave={noop} />
      </ErrorBoundary>
    </ModalProvider>
  );
  fireEvent.keyDown(baseElement, { key: "Escape", code: "Escape" });
  expect(mockFn).toHaveBeenCalled();
});
