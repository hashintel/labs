import React from "react";
import ReactDOM from "react-dom";

import { HashCoreContextMenu } from "./HashCoreContextMenu";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<HashCoreContextMenu style={{ top: 0, left: 0 }} />, div);
  ReactDOM.unmountComponentAtNode(div);
});
