import React from "react";
import ReactDOM from "react-dom";

import { IconPackageDown } from "./IconPackageDown";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconPackageDown />, div);
  ReactDOM.unmountComponentAtNode(div);
});
