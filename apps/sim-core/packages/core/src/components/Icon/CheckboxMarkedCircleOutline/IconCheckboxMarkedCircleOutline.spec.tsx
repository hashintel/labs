import React from "react";
import ReactDOM from "react-dom";

import { IconCheckboxMarkedCircleOutline } from "./IconCheckboxMarkedCircleOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCheckboxMarkedCircleOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
