// TODO: Fix these tests. They are suffering from the same problem as ExperimentModal.spec.tsx
// And it is also happening here because <HashCoreFiles> calls the ExperimentModal, which in
// turn needs to be wrapped with the proper providers

describe.skip("HashCoreFilesListItemFolder tests", () => {
  it.todo("Please FIXME. See this file for more info.");
});

export const thisMustBeHereToMakeTheBuildHappyAboutTheFactThatWeDoNotHaveAnImport =
  "this must Be Here To Make The Build Happy About The Fact That We Do Not Have An Import";
// import React from "react";
// import ReactDOM from "react-dom";
// import { Provider } from "react-redux";
// import { ModalProvider } from "react-modal-hook";
// import { render, screen, fireEvent } from "@testing-library/react";

// import { HashCoreFilesListItemFolder } from "./HashCoreFilesListItemFolder";
// import { mockProject } from "../../../../features/project/mocks";
// import { parseRelativePathsAsTree } from "../../../../features/files/utils";
// import { setProjectWithMeta } from "../../../../features/actions";
// import { store } from "../../../../features/store";

// Element.prototype.scrollIntoView = jest.fn();
// const mockFiles = parseRelativePathsAsTree(mockProject.files);

// it("renders without crashing", () => {
//   const div = document.createElement("div");

//   store.dispatch(setProjectWithMeta(mockProject));

//   ReactDOM.render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           childrenItems={mockFiles}
//           toggleOpen={() => {}}
//           openPaths={{}}
//         />
//       </ModalProvider>
//     </Provider>,
//     div
//   );
//   ReactDOM.unmountComponentAtNode(div);
// });

// it("renders null if no files", () => {
//   const div = document.createElement("div");

//   store.dispatch(setProjectWithMeta(mockProject));

//   const result = ReactDOM.render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           childrenItems={[]}
//           toggleOpen={() => {}}
//           openPaths={{}}
//         />
//       </ModalProvider>
//     </Provider>,
//     div
//   );
//   expect(result).toBe(null);
//   ReactDOM.unmountComponentAtNode(div);
// });

// it("should render the root virtual folder", () => {
//   store.dispatch(setProjectWithMeta(mockProject));
//   const { getByTestId } = render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           rootFolder={true}
//           childrenItems={mockFiles}
//           toggleOpen={() => {}}
//           openPaths={{}}
//         />
//       </ModalProvider>
//     </Provider>
//   );
//   const element = getByTestId("HashCoreFilesListItemFolder-");
//   expect(element).toBeDefined();
//   expect(element.textContent).not.toContain("root"); // must never display the span
// });

// it("should call toggleOpen when clicked", () => {
//   store.dispatch(setProjectWithMeta(mockProject));
//   const mockFn = jest.fn();
//   render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           rootFolder={true}
//           childrenItems={mockFiles}
//           toggleOpen={mockFn}
//           openPaths={{}}
//         />
//       </ModalProvider>
//     </Provider>
//   );

//   const target = screen.getByText("src");
//   fireEvent.click(target);
//   expect(mockFn).toHaveBeenCalled();
// });

// it("should show folder closed when isOpen=false", () => {
//   store.dispatch(setProjectWithMeta(mockProject));
//   render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           rootFolder={true}
//           childrenItems={mockFiles}
//           toggleOpen={() => {}}
//           openPaths={{}}
//         />
//       </ModalProvider>
//     </Provider>
//   );

//   const target: any = screen.getByText("src");
//   const sibling = Object.values(target.previousElementSibling);
//   const icon: any = sibling.pop();
//   expect(icon.className).toBe("Icon IconFolder");
// });

// it("should show folder open when openPaths contains the selected path", () => {
//   store.dispatch(setProjectWithMeta(mockProject));
//   render(
//     <Provider store={store}>
//       <ModalProvider>
//         <HashCoreFilesListItemFolder
//           name="root"
//           repoPath=""
//           scrollIntoViewRef={{ current: null }}
//           rootFolder={true}
//           childrenItems={mockFiles}
//           toggleOpen={() => {}}
//           openPaths={{ src: true }}
//         />
//       </ModalProvider>
//     </Provider>
//   );

//   let target: any = screen.getByText("src");
//   fireEvent.click(target);
//   target = screen.getByText("src");
//   const sibling = Object.values(target.previousElementSibling);
//   const icon: any = sibling.pop();
//   expect(icon.className).toBe("Icon IconFolderOpen");
// });
