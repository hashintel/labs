import React from "react";
import { render } from "@testing-library/react";

import { ErrorDetails } from "./ErrorDetails";

it("renders without crashing", () => {
  render(
    <ErrorDetails
      errorName={"errorName"}
      errorMessage={"errorMessage"}
      errorStack={"errorStack"}
      hidden={true}
    />,
  );
});
