import React from "react";
import ReactDOM from "react-dom";

import { IconBrain } from "./IconBrain";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconBrain />, div);
  ReactDOM.unmountComponentAtNode(div);
});
