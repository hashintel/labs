import React from "react";
import { render } from "@testing-library/react";

import { ModalPrivateDependencies } from "./ModalPrivateDependencies";
import { ProjectProvider } from "../../../features/project/ProjectContext";

it("renders without crashing", () => {
  render(
    <ProjectProvider>
      <ModalPrivateDependencies onClose={() => {}} />
    </ProjectProvider>,
  );
});
