import React from "react";
import ReactDOM from "react-dom";

import { SimpleTooltip } from "./SimpleTooltip";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<SimpleTooltip position="above" />, div);
  ReactDOM.unmountComponentAtNode(div);
});
