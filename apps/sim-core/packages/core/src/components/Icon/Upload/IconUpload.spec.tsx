import React from "react";
import ReactDOM from "react-dom";

import { IconUpload } from "./IconUpload";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconUpload />, div);
  ReactDOM.unmountComponentAtNode(div);
});
