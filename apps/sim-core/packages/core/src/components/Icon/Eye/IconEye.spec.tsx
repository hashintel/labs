import React from "react";
import ReactDOM from "react-dom";

import { IconEye } from "./IconEye";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconEye />, div);
  ReactDOM.unmountComponentAtNode(div);
});
