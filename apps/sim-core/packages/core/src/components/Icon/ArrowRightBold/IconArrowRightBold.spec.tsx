import React from "react";
import ReactDOM from "react-dom";

import { IconArrowRightBold } from "./IconArrowRightBold";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconArrowRightBold />, div);
  ReactDOM.unmountComponentAtNode(div);
});
