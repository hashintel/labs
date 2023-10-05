import React from "react";
import ReactDOM from "react-dom";

import { IconChevronRight } from "./IconChevronRight";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconChevronRight />, div);
  ReactDOM.unmountComponentAtNode(div);
});
