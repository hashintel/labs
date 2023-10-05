import React from "react";
import ReactDOM from "react-dom";

import { IconFolderLock } from "./IconFolderLock";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconFolderLock />, div);
  ReactDOM.unmountComponentAtNode(div);
});
