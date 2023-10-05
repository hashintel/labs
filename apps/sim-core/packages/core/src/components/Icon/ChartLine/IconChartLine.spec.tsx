import React from "react";
import ReactDOM from "react-dom";

import { IconChartLine } from "./IconChartLine";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconChartLine />, div);
  ReactDOM.unmountComponentAtNode(div);
});
