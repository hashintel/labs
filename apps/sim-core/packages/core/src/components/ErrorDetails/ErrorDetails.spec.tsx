import React from "react";
import ReactDOM from "react-dom";

import { ErrorDetails } from "./ErrorDetails";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <ErrorDetails
      errorName={"errorName"}
      errorMessage={"errorMessage"}
      errorStack={"errorStack"}
      hidden={true}
    />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
