import React from "react";
import { render } from "@testing-library/react";

import { ModalFormEntry } from "./ModalFormEntry";

it("renders without crashing", () => {
  render(<ModalFormEntry label="TEST" />);
});
