import React from "react";
import ReactDOM from "react-dom";

import { IconPresentationPause } from "./IconPresentationPause";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPresentationPause />, div);
  ReactDOM.unmountComponentAtNode(div);
});
