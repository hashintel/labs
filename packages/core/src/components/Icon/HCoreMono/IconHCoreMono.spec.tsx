import React from "react";
import ReactDOM from "react-dom";

import { IconHCoreMono } from "./IconHCoreMono";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconHCoreMono />, div);
  ReactDOM.unmountComponentAtNode(div);
});
