import React from "react";
import ReactDOM from "react-dom";

import { ModalFormEntryPublishAs } from "./ModalFormEntryPublishAs";

it("renders without crashing", () => {
  const div = document.createElement("div");

  const user = {
    subLabel: "user",
    value: "",
    label: "User",
  };
  ReactDOM.render(
    <ModalFormEntryPublishAs
      buttonLabel="PUBLISH SIMULATION"
      publishAsOptions={[user]}
      selectedPublishAs={user}
      setSelectedPublishAs={() => {}}
    />,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
