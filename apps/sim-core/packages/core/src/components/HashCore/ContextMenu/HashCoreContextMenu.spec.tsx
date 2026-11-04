import React from "react";
import { render } from "@testing-library/react";

import { HashCoreContextMenu } from "./HashCoreContextMenu";

it("renders without crashing", () => {
  render(<HashCoreContextMenu style={{ top: 0, left: 0 }} />);
});
