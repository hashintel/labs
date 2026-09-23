import React from "react";
import { render } from "@testing-library/react";

import { ModalNameBehavior } from "./ModalNameBehavior";

it("renders without crashing", () => {
  render(
    <ModalNameBehavior
      onSubmit={() => {}}
      onCancel={() => {}}
      name="some_name"
      onNameChange={() => {}}
      errorMessage=""
      languageOptions={[]}
      selectedLanguage={{ value: "", label: "" }}
      onSelectedLanguageChange={() => {}}
      action="Create"
      placeholder="Name your new file"
    />,
  );
});
