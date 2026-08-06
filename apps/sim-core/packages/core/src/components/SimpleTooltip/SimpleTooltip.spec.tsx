import React from "react";
import { render } from "@testing-library/react";

import { SimpleTooltip } from "./SimpleTooltip";

it("renders without crashing", () => {
  render(<SimpleTooltip position="above" />);
});
