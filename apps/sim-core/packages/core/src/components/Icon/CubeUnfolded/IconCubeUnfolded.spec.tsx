import React from "react";
import ReactDOM from "react-dom";

import { IconCubeUnfolded } from "./IconCubeUnfolded";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconCubeUnfolded />, div);
  ReactDOM.unmountComponentAtNode(div);
});
