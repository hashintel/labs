import React from "react";
import ReactDOM from "react-dom";

import { IconKeyPlus } from "./IconKeyPlus";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconKeyPlus />, div);
  ReactDOM.unmountComponentAtNode(div);
});
