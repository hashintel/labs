import React from "react";
import ReactDOM from "react-dom";

import { IconDiscord } from "./IconDiscord";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconDiscord />, div);
  ReactDOM.unmountComponentAtNode(div);
});
