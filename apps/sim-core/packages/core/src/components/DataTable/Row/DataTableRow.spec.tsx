import React from "react";
import { render } from "@testing-library/react";

import { DataTableRow } from "./DataTableRow";

it("renders without crashing", () => {
  render(
    <table>
      <tbody>
        <DataTableRow rowIndex={0} record={[]} />
      </tbody>
    </table>,
  );
});
