import React from "react";
import ReactDOM from "react-dom";

import { IconCreatePlot } from "./IconCreatePlot";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCreatePlot />, div);
  ReactDOM.unmountComponentAtNode(div);
});
