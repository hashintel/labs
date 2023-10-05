import React from "react";
import ReactDOM from "react-dom";

import { IconExperimentsCreate } from "./IconExperimentsCreate";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconExperimentsCreate />, div);
  ReactDOM.unmountComponentAtNode(div);
});
