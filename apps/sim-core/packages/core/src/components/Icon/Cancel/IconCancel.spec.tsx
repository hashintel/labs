import React from "react";
import ReactDOM from "react-dom";

import { IconCancel } from "./IconCancel";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCancel />, div);
  ReactDOM.unmountComponentAtNode(div);
});
