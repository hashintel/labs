import React from "react";
import ReactDOM from "react-dom";

import { IconArrowDownDrop } from "./IconArrowDownDrop";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconArrowDownDrop />, div);
  ReactDOM.unmountComponentAtNode(div);
});
