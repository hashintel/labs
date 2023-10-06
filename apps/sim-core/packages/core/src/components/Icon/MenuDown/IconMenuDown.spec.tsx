import React from "react";
import ReactDOM from "react-dom";

import { IconMenuDown } from "./IconMenuDown";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconMenuDown />, div);
  ReactDOM.unmountComponentAtNode(div);
});
