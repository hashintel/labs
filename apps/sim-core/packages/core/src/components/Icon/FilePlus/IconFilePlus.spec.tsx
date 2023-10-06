import React from "react";
import ReactDOM from "react-dom";

import { IconFilePlus } from "./IconFilePlus";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconFilePlus />, div);
  ReactDOM.unmountComponentAtNode(div);
});
