import React from "react";
import ReactDOM from "react-dom";

import { IconTableAdd } from "./IconTableAdd";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconTableAdd />, div);
  ReactDOM.unmountComponentAtNode(div);
});
