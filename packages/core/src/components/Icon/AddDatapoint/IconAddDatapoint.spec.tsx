import React from "react";
import ReactDOM from "react-dom";

import { IconAddDatapoint } from "./IconAddDatapoint";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<IconAddDatapoint />, div);
  ReactDOM.unmountComponentAtNode(div);
});
