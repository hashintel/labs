import React from "react";
import ReactDOM from "react-dom";

import { IconAlert } from "./IconAlert";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconAlert />, div);
  ReactDOM.unmountComponentAtNode(div);
});
