import React from "react";
import { render } from "@testing-library/react";

import { ModalFormEntryDropdown } from "./ModalFormEntryDropdown";

it("renders without crashing", () => {
  render(
    <ModalFormEntryDropdown
      label="TEST"
      options={[]}
      value={undefined}
      onChange={() => {}}
    />,
  );
});
