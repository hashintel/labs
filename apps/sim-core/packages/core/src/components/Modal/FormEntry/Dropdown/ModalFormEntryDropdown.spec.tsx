import React from "react";
import ReactDOM from "react-dom";

import { ModalFormEntryDropdown } from "./ModalFormEntryDropdown";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ModalFormEntryDropdown
      label="TEST"
      options={[]}
      value={undefined}
      onChange={() => {}}
    />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
