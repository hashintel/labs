import React from "react";
import ReactDOM from "react-dom";

import { FileBannerBuiltin } from "./FileBannerBuiltin";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<FileBannerBuiltin />, div);
  ReactDOM.unmountComponentAtNode(div);
});
