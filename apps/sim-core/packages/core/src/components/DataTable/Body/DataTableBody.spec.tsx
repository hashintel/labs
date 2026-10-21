import React from "react";
import { render } from "@testing-library/react";

import { DataTableBody } from "./DataTableBody";

it("renders without crashing", () => {
  render(
    <table>
      <DataTableBody beginIndex={0} records={[]} />
    </table>,
  );
});
