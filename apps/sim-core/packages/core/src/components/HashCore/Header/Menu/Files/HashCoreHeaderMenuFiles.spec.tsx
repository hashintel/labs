import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";

import { HashCoreHeaderMenuFiles } from "./HashCoreHeaderMenuFiles";
import { store } from "../../../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
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
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
