import React from "react";
import ReactDOM from "react-dom";

import { IconDotsHorizontal } from "./IconDotsHorizontal";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconDotsHorizontal />, div);
  ReactDOM.unmountComponentAtNode(div);
});
