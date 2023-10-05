import React from "react";
import ReactDOM from "react-dom";

import { IconTableLarge } from "./IconTableLarge";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconTableLarge />, div);
  ReactDOM.unmountComponentAtNode(div);
});
