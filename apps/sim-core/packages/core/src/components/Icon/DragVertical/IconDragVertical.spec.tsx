import React from "react";
import ReactDOM from "react-dom";

import { IconDragVertical } from "./IconDragVertical";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconDragVertical />, div);
  ReactDOM.unmountComponentAtNode(div);
});
