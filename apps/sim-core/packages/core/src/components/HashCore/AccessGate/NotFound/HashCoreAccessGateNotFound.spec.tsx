import React from "react";
import ReactDOM from "react-dom";

import { HashCoreAccessGateNotFound } from "./HashCoreAccessGateNotFound";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <HashCoreAccessGateNotFound requestedProject={null} embedded={false} />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
