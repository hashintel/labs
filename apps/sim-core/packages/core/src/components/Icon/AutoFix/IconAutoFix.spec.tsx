import React from "react";
import ReactDOM from "react-dom";

import { IconAutoFix } from "./IconAutoFix";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconAutoFix />, div);
  ReactDOM.unmountComponentAtNode(div);
});
