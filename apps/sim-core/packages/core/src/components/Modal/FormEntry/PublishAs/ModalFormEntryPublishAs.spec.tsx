import React from "react";
import { render } from "@testing-library/react";

import { ModalFormEntryPublishAs } from "./ModalFormEntryPublishAs";

it("renders without crashing", () => {
  const user = {
    subLabel: "user",
    value: "",
    label: "User",
  };
  render(
    <ModalFormEntryPublishAs
      buttonLabel="PUBLISH SIMULATION"
      publishAsOptions={[user]}
      selectedPublishAs={user}
      setSelectedPublishAs={() => {}}
    />,
  );
});
