import React from "react";
import ReactDOM from "react-dom";

import { ModalNameBehavior } from "./ModalNameBehavior";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
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
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
