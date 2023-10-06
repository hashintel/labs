import React from "react";
import ReactDOM from "react-dom";

import { IconPlus } from "./IconPlus";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPlus />, div);
  ReactDOM.unmountComponentAtNode(div);
});
