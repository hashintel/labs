import React from "react";
import ReactDOM from "react-dom";

import { IconAlertOutline } from "./IconAlertOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconAlertOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
