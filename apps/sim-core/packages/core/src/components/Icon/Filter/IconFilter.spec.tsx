import React from "react";
import ReactDOM from "react-dom";

import { IconFilter } from "./IconFilter";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconFilter />, div);
  ReactDOM.unmountComponentAtNode(div);
});
