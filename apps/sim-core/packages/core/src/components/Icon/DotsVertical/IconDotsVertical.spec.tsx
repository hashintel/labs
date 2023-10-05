import React from "react";
import ReactDOM from "react-dom";

import { IconDotsVertical } from "./IconDotsVertical";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconDotsVertical />, div);
  ReactDOM.unmountComponentAtNode(div);
});
