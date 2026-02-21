import React from "react";
import ReactDOM from "react-dom";

import { ModalPrivateDependencies } from "./ModalPrivateDependencies";
import { ProjectProvider } from "../../../features/project/ProjectContext";

it("renders without crashing", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <ProjectProvider>
      <ModalPrivateDependencies onClose={() => {}} />
    </ProjectProvider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
