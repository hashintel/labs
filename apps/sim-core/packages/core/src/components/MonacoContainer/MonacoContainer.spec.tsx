import React from "react";
import { render } from "@testing-library/react";

import { MonacoContainer } from "./MonacoContainer";

it("renders without crashing", () => {
  render(<MonacoContainer hidden={false} />);
});
