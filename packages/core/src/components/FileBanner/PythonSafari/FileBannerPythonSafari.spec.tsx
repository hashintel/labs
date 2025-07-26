import React from "react";
import ReactDOM from "react-dom";

import { FileBannerPythonSafari } from "./FileBannerPythonSafari";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<FileBannerPythonSafari />, div);
  ReactDOM.unmountComponentAtNode(div);
});
