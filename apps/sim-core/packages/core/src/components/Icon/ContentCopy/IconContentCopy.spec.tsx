import React from "react";
import ReactDOM from "react-dom";

import { IconContentCopy } from "./IconContentCopy";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconContentCopy />, div);
  ReactDOM.unmountComponentAtNode(div);
});
