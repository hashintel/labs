import React from "react";
import ReactDOM from "react-dom";

import { IconKeyboardReturn } from "./IconKeyboardReturn";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconKeyboardReturn />, div);
  ReactDOM.unmountComponentAtNode(div);
});
