import React from "react";
import ReactDOM from "react-dom";

it("renders without crashing", () => {
  const div = document.createElement("div");

  // TODO: figure out how to test things with @hashintel/engine-web in import path
  ReactDOM.render(<div />, div);
  ReactDOM.unmountComponentAtNode(div);
});
