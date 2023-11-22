import React from "react";
import ReactDOM from "react-dom";

import { FileBannerChoose } from "./FileBannerChoose";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <FileBannerChoose
      labelA=""
      onChooseA={() => {}}
      labelB=""
      onChooseB={() => {}}
    />,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
