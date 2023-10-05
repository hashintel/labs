import React from "react";
import ReactDOM from "react-dom";

import { IconRestart } from "./IconRestart";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconRestart />, div);
  ReactDOM.unmountComponentAtNode(div);
});
