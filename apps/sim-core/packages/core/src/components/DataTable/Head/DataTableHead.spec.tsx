import React from "react";
import { render } from "@testing-library/react";

import { DataTableHead } from "./DataTableHead";

it("renders without crashing", () => {
  render(
    <table>
      <DataTableHead headings={[]} />
    </table>,
  );
});
