import React from "react";
import ReactDOM from "react-dom";

import { IconMore } from "./IconMore";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconMore />, div);
  ReactDOM.unmountComponentAtNode(div);
});
