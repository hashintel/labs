import React from "react";
import ReactDOM from "react-dom";

import { IconCodeTagsCheck } from "./IconCodeTagsCheck";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCodeTagsCheck />, div);
  ReactDOM.unmountComponentAtNode(div);
});
