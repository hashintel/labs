import React from "react";
import ReactDOM from "react-dom";

import { IconFileFind } from "./IconFileFind";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconFileFind />, div);
  ReactDOM.unmountComponentAtNode(div);
});
