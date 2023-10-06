import React from "react";
import ReactDOM from "react-dom";

import { IconRunFast } from "./IconRunFast";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconRunFast />, div);
  ReactDOM.unmountComponentAtNode(div);
});
