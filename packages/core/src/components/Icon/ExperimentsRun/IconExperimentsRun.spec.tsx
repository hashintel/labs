import React from "react";
import ReactDOM from "react-dom";

import { IconExperimentsRun } from "./IconExperimentsRun";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconExperimentsRun />, div);
  ReactDOM.unmountComponentAtNode(div);
});
