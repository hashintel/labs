import React from "react";
import ReactDOM from "react-dom";

import { MonacoContainer } from "./MonacoContainer";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<MonacoContainer hidden={false} />, div);
  ReactDOM.unmountComponentAtNode(div);
});
