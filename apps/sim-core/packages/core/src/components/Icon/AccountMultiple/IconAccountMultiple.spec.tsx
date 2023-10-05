import React from "react";
import ReactDOM from "react-dom";

import { IconAccountMultiple } from "./IconAccountMultiple";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconAccountMultiple />, div);
  ReactDOM.unmountComponentAtNode(div);
});
