import React from "react";
import { render } from "@testing-library/react";
import { ModalProvider } from "react-modal-hook";

import { HashCoreHeaderMenuFiles } from "./HashCoreHeaderMenuFiles";
import { ProjectProvider } from "../../../../../features/project/ProjectContext";
import { UserProvider } from "../../../../../features/user/UserContext";

it("renders without crashing", () => {
  render(
    <UserProvider>
      <ProjectProvider>
        <ModalProvider>
          <HashCoreHeaderMenuFiles
            openMenuItem=""
            openSubmenuItem=""
            clearAll={() => {}}
            onClickMenuItemLabel={() => {}}
            onMouseEnterMenuItemLabel={() => {}}
            onMouseEnterSubmenuItemLabel={() => {}}
            onMouseEnterSubmenuItem={() => {}}
            onMouseLeaveSubmenuItem={() => {}}
            userProjects={[]}
            exampleProjects={[]}
          />
        </ModalProvider>
      </ProjectProvider>
    </UserProvider>,
  );
});
