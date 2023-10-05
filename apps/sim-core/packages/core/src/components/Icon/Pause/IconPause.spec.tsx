import React from "react";
import ReactDOM from "react-dom";

import { IconPause } from "./IconPause";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPause />, div);
  ReactDOM.unmountComponentAtNode(div);
});
