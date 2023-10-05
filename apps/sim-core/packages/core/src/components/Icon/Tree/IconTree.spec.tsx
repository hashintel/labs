import React from "react";
import ReactDOM from "react-dom";

import { IconTree } from "./IconTree";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconTree />, div);
  ReactDOM.unmountComponentAtNode(div);
});
