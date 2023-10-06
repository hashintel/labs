import React from "react";
import ReactDOM from "react-dom";

import { IconCreateDashboard } from "./IconCreateDashboard";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCreateDashboard />, div);
  ReactDOM.unmountComponentAtNode(div);
});
