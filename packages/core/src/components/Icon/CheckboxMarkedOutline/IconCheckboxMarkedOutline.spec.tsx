import React from "react";
import ReactDOM from "react-dom";

import { IconCheckboxMarkedOutline } from "./IconCheckboxMarkedOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCheckboxMarkedOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
