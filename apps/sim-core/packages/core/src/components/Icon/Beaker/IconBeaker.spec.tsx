import React from "react";
import ReactDOM from "react-dom";

import { IconBeaker } from "./IconBeaker";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconBeaker />, div);
  ReactDOM.unmountComponentAtNode(div);
});
