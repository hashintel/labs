import React from "react";
import { render } from "@testing-library/react";

import { FileBannerChoose } from "./FileBannerChoose";

it("renders without crashing", () => {
  render(
    <FileBannerChoose
      labelA=""
      onChooseA={() => {}}
      labelB=""
      onChooseB={() => {}}
    />,
  );
});
