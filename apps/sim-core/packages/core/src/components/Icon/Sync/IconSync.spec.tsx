import React from "react";
import ReactDOM from "react-dom";

import { IconSync } from "./IconSync";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconSync />, div);
  ReactDOM.unmountComponentAtNode(div);
});
