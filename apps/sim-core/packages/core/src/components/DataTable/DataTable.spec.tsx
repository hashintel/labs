import React from "react";
import { render } from "@testing-library/react";

import { DataTable } from "./DataTable";

it("renders without crashing", () => {
  render(<DataTable headings={[]} records={[]} />);
});
