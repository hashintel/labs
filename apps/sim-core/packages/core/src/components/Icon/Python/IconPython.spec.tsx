import React from "react";
import ReactDOM from "react-dom";

import { IconPython } from "./IconPython";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPython />, div);
  ReactDOM.unmountComponentAtNode(div);
});
