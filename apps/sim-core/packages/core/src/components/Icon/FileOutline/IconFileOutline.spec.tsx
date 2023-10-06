import React from "react";
import ReactDOM from "react-dom";

import { IconFileOutline } from "./IconFileOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconFileOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
