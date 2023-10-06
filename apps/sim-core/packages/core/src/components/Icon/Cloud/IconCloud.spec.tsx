import React from "react";
import ReactDOM from "react-dom";

import { IconCloud } from "./IconCloud";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCloud />, div);
  ReactDOM.unmountComponentAtNode(div);
});
