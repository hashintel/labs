import React from "react";
import { render } from "@testing-library/react";

import { ErrorBoundary } from "./ErrorBoundary";

it("renders without crashing", () => {
  render(<ErrorBoundary>{null}</ErrorBoundary>);
});
