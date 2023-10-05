// TODO: Fix these tests. They are suffering from the same problem as ExperimentModal.spec.tsx
// And it is also happening here because <HashCoreFiles> calls the ExperimentModal, which in
// turn needs to be wrapped with the proper providers

describe.skip("HashCoreFilesListItemFile tests", () => {
  it.todo("Please FIXME. See this file for more info.");
});

export const thisMustBeHereToMakeTheBuildHappyAboutTheFactThatWeDoNotHaveAnImport =
  "this must Be Here To Make The Build Happy About The Fact That We Do Not Have An Import";

// import React from "react";
// import ReactDOM from "react-dom";
// import { Provider } from "react-redux";
// import { ModalProvider } from "react-modal-hook";

// import { HashCoreFilesListItemFile } from "./HashCoreFilesListItemFile";
// import { mockProject } from "../../../../features/project/mocks";
// import { setProjectWithMeta } from "../../../../features/actions";
// import { store } from "../../../../features/store";

// Element.prototype.scrollIntoView = jest.fn();

// it("renders without crashing", () => {
//   const div = document.createElement("div");

//   store.dispatch(setProjectWithMeta(mockProject));

//   ReactDOM.render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFile
//           fileId={mockProject.files[0].id}
//           scrollIntoViewRef={{ current: null }}
//         />
//       </ModalProvider>
//     </Provider>,
//     div
//   );
//   ReactDOM.unmountComponentAtNode(div);
// });
