import React from "react";
import ReactDOM from "react-dom";

import { IconSpinner } from "./IconSpinner";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconSpinner />, div);
  ReactDOM.unmountComponentAtNode(div);
});
