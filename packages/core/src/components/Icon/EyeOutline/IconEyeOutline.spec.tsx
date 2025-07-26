import React from "react";
import ReactDOM from "react-dom";

import { IconEyeOutline } from "./IconEyeOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconEyeOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
