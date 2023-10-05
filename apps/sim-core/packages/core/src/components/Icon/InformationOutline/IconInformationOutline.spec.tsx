import React from "react";
import ReactDOM from "react-dom";

import { IconInformationOutline } from "./IconInformationOutline";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconInformationOutline />, div);
  ReactDOM.unmountComponentAtNode(div);
});
