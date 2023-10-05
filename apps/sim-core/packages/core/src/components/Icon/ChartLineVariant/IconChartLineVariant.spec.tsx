import React from "react";
import ReactDOM from "react-dom";

import { IconChartLineVariant } from "./IconChartLineVariant";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconChartLineVariant />, div);
  ReactDOM.unmountComponentAtNode(div);
});
