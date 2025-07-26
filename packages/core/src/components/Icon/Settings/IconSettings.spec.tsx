import React from "react";
import ReactDOM from "react-dom";

import { IconSettings } from "./IconSettings";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconSettings />, div);
  ReactDOM.unmountComponentAtNode(div);
});
