import React from "react";
import ReactDOM from "react-dom";

import { IconOpenInNew } from "./IconOpenInNew";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconOpenInNew />, div);
  ReactDOM.unmountComponentAtNode(div);
});
