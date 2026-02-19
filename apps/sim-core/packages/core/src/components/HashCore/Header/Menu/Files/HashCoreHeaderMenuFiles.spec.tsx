import React from "react";
import ReactDOM from "react-dom";
import { ModalProvider } from "react-modal-hook";

import { HashCoreHeaderMenuFiles } from "./HashCoreHeaderMenuFiles";
import { ProjectProvider } from "../../../../../features/project/ProjectContext";
import { UserProvider } from "../../../../../features/user/UserContext";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
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
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
