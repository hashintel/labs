import React from "react";
import ReactDOM from "react-dom";

import { IconLock } from "./IconLock";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconLock />, div);
  ReactDOM.unmountComponentAtNode(div);
});
