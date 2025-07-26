import React from "react";
import ReactDOM from "react-dom";

import { IconStop } from "./IconStop";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconStop />, div);
  ReactDOM.unmountComponentAtNode(div);
});
