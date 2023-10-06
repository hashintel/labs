import React from "react";
import ReactDOM from "react-dom";

import { FileBannerUpgrade } from "./FileBannerUpgrade";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<FileBannerUpgrade />, div);
  ReactDOM.unmountComponentAtNode(div);
});
