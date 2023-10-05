import React from "react";
import ReactDOM from "react-dom";

import { IconContentDuplicate } from "./IconContentDuplicate";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconContentDuplicate />, div);
  ReactDOM.unmountComponentAtNode(div);
});
