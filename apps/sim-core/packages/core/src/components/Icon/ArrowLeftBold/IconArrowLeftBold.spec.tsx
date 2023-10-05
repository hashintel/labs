import React from "react";
import ReactDOM from "react-dom";

import { IconArrowLeftBold } from "./IconArrowLeftBold";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconArrowLeftBold />, div);
  ReactDOM.unmountComponentAtNode(div);
});
