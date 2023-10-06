import React from "react";
import ReactDOM from "react-dom";

import { IconEarth } from "./IconEarth";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconEarth />, div);
  ReactDOM.unmountComponentAtNode(div);
});
