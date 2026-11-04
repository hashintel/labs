import React from "react";
import { render } from "@testing-library/react";

import { HashCoreAccessGateNotFound } from "./HashCoreAccessGateNotFound";

it("renders without crashing", () => {
  render(
    <HashCoreAccessGateNotFound requestedProject={null} embedded={false} />,
  );
});
