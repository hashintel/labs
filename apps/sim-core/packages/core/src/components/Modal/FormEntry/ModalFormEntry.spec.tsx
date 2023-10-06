import React from "react";
import ReactDOM from "react-dom";

import { ModalFormEntry } from "./ModalFormEntry";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<ModalFormEntry label="TEST" />, div);
  ReactDOM.unmountComponentAtNode(div);
});
