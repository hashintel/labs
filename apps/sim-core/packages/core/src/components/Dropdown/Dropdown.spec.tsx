import React from "react";
import { render } from "@testing-library/react";

import { Dropdown } from "./Dropdown";

it("renders without crashing", () => {
  render(
    <Dropdown options={[]} value={undefined} onChange={() => {}} />,
  );
});
