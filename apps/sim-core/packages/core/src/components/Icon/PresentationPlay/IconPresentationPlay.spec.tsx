import React from "react";
import ReactDOM from "react-dom";

import { IconPresentationPlay } from "./IconPresentationPlay";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPresentationPlay />, div);
  ReactDOM.unmountComponentAtNode(div);
});
