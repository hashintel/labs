import React from "react";
import ReactDOM from "react-dom";

import { IconImport } from "./IconImport";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconImport />, div);
  ReactDOM.unmountComponentAtNode(div);
});
