import React from "react";
import { render } from "@testing-library/react";

import { ModalFormEntryRequiredText } from "./ModalFormEntryRequiredText";

it("renders without crashing", () => {
  render(
    <ModalFormEntryRequiredText
      label="label"
      placeholder="placeholder"
      value="title"
      errorMessage={undefined}
      onChange={() => undefined}
      onBlur={() => undefined}
    />,
  );
});
