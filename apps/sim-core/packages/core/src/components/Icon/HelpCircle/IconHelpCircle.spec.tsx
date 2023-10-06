import React from "react";
import ReactDOM from "react-dom";

import { IconHelpCircle } from "./IconHelpCircle";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconHelpCircle />, div);
  ReactDOM.unmountComponentAtNode(div);
});
