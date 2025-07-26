import React from "react";
import ReactDOM from "react-dom";

import { IconDirectionsFork } from "./IconDirectionsFork";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconDirectionsFork />, div);
  ReactDOM.unmountComponentAtNode(div);
});
