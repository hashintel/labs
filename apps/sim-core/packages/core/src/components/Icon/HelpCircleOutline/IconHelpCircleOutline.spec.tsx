import React from "react";
import ReactDOM from "react-dom";

import { IconHelpCircleOutline } from "./IconHelpCircleOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconHelpCircleOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
