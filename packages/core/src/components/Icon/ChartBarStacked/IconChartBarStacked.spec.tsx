import React from "react";
import ReactDOM from "react-dom";

import { IconChartBarStacked } from "./IconChartBarStacked";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconChartBarStacked />, div);
  ReactDOM.unmountComponentAtNode(div);
});
