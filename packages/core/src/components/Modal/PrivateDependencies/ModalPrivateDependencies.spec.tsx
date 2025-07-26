import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { ModalPrivateDependencies } from "./ModalPrivateDependencies";
import { mockProject } from "../../../features/project/mocks";
import { setProjectWithMeta } from "../../../features/actions";
import { store } from "../../../features/store";

it("renders without crashing", () => {
  const div = document.createElement("div");

  //@ts-expect-error redux problems
  store.dispatch(setProjectWithMeta(mockProject));

  ReactDOM.render(
    <Provider store={store}>
      <ModalPrivateDependencies onClose={() => {}} />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
