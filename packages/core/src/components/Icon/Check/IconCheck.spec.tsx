import React from "react";
import ReactDOM from "react-dom";

import { IconCheck } from "./IconCheck";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCheck />, div);
  ReactDOM.unmountComponentAtNode(div);
});
