import React from "react";
import ReactDOM from "react-dom";

import { ModalFormEntryRequiredText } from "./ModalFormEntryRequiredText";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ModalFormEntryRequiredText
      label="label"
      placeholder="placeholder"
      value="title"
      errorMessage={undefined}
      onChange={() => undefined}
      onBlur={() => undefined}
    />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
