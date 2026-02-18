import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";

import { HashCoreHeaderMenuFiles } from "./HashCoreHeaderMenuFiles";
import { ProjectProvider } from "../../../../../features/project/ProjectContext";
import { UserProvider } from "../../../../../features/user/UserContext";
import { store } from "../../../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
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
      </UserProvider>
    </Provider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
