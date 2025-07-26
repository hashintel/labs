import React from "react";
import ReactDOM from "react-dom";

import { IconTrash } from "./IconTrash";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconTrash />, div);
  ReactDOM.unmountComponentAtNode(div);
});
