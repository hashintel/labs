import React from "react";
import { render, fireEvent } from "@testing-library/react";

import { Search } from "./Search";

jest.useFakeTimers();

jest.mock("lodash", () => ({
  debounce: jest.fn((fn) => (...args: any[]) => setTimeout(() => fn(...args))),
}));

it("renders without crashing", () => {
  render(<Search searchTerm="" loading={false} onChange={() => {}} />);
});

it("calls onChange when the value has changed", () => {
  const onChange = jest.fn();
  const { getByPlaceholderText } = render(
    <Search onChange={onChange} loading={false} searchTerm="" />
  );

  fireEvent.change(getByPlaceholderText("Search..."), {
    target: { value: "test" },
  });

  expect(onChange).toHaveBeenCalled();
});
