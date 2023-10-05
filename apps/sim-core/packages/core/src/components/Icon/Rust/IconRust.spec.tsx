import React from "react";
import ReactDOM from "react-dom";

import { IconRust } from "./IconRust";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconRust />, div);
  ReactDOM.unmountComponentAtNode(div);
});
