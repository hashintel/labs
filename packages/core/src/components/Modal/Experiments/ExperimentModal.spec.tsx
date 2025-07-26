describe.skip("ExperimentModal tests", () => {
  it.todo("Please FIXME. See this file for more info.");
});

export const thisMustBeHereToMakeTheBuildHappyAboutTheFactThatWeDoNotHaveAnImport =
  "this must Be Here To Make The Build Happy About The Fact That We Do Not Have An Import";
// import { Provider } from "react-redux";
// import { ModalProvider } from "react-modal-hook";
// import { screen, render, fireEvent } from "@testing-library/react";
// import userEvent, { TargetElement } from "@testing-library/user-event";

// import { ExperimentModal } from "./ExperimentModal";
// import { mockProject } from "../../../features/project/mocks";
// import { setProjectWithMeta } from "../../../features/actions";
// import { store } from "../../../features/store";

// TODO: Fix these tests. They are failing with the following error:
// ReferenceError: WEBPACK_PUBLIC_PATH is not defined
//    import { getLocalStorageSimulatorTarget } from "./target";
// >  const workerUrl = urljoin(WEBPACK_PUBLIC_PATH, "simulationworker.js");
// Most probably this is happening because the Jest pipeline is not running through webpack,
// or I am missing another layer of Providers

// describe.skip("ExperimentModal tests", () => {
//   it("renders without crashing", () => {
//     const div = document.createElement("div");
//     ReactDOM.render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={() => {}} />
//         </ModalProvider>
//       </Provider>,
//       div
//     );
//     ReactDOM.unmountComponentAtNode(div);
//   });

//   it("submitting should fail due to validation (title)", () => {
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const submitButton = screen.getByText("Create experiment");
//     fireEvent.click(submitButton);
//     expect(mockFn).not.toHaveBeenCalled();
//     expect(screen.getByText("This field is required")).toBeDefined();
//   });

//   it.todo("submitting should fail due to validation (duplicated title)");

//   it("submitting should fail due to validation for values.field and values.values", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const titleInput: HTMLElement & {
//       value?: string;
//     } = screen.getByPlaceholderText("Experiment title");
//     expect(titleInput).toBeDefined();
//     userEvent.type(titleInput, "Wonderful title");
//     expect(titleInput.value).toBe("Wonderful title");
//     const submitButton = screen.getByText("Create experiment");
//     userEvent.click(submitButton);
//     expect(mockFn).not.toHaveBeenCalled();

//     const fieldValues = screen.getByPlaceholderText("Comma, separated, list");

//     expect(
//       fieldValues.classList.contains("ExperimentModal__ErroredField")
//     ).toBeTruthy();
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     userEvent.type(fieldValues, "pizza, pasta, gelato");
//     expect(
//       fieldValues.classList.contains("ExperimentModal__ErroredField")
//     ).toBeFalsy();
//   });

//   it("should create new experiment (type: values)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const fieldValues = screen.getByPlaceholderText("Comma, separated, list");
//     const title = "Wonderful title";
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     userEvent.type(fieldValues, "pizza, pasta, gelato");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("values");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.values).toContain("pizza");
//     expect(contents?.[title]?.values).toContain(" pasta");
//     expect(contents?.[title]?.values).toContain(" gelato");
//   });

//   it("should create new experiment (type: linspace)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const linspaceElement = screen.getByText("Linspace sweeping");
//     userEvent.click(linspaceElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Linspace Sweeping
//     const startInput = screen.getByTestId("input-linspace-start");
//     const stopInput = screen.getByTestId("input-linspace-stop");
//     const samplesInput = screen.getByTestId("input-linspace-samples");
//     userEvent.type(startInput, "{backspace}3");
//     userEvent.type(stopInput, "{backspace}4");
//     userEvent.type(samplesInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("linspace");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.start).toBe(3);
//     expect(contents?.[title]?.stop).toBe(4);
//     expect(contents?.[title]?.samples).toBe(5);
//   });

//   it("should create new experiment (type: arange)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Arange sweeping");
//     userEvent.click(arangeElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const startInput = screen.getByTestId("input-arange-start");
//     const stopInput = screen.getByTestId("input-arange-stop");
//     const incrementInput = screen.getByTestId("input-arange-increment");
//     userEvent.type(startInput, "{backspace}3");
//     userEvent.type(stopInput, "{backspace}4");
//     userEvent.type(incrementInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("arange");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.start).toBe(3);
//     expect(contents?.[title]?.stop).toBe(4);
//     expect(contents?.[title]?.increment).toBe(5);
//   });

//   it("should create new experiment (type: MonteCarlo, distribution: normal)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const stdInput = screen.getByTestId("input-montecarlo-normal-std");
//     const meanInput = screen.getByTestId("input-montecarlo-normal-mean");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(stdInput, "{backspace}4");
//     userEvent.type(meanInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("normal");
//     expect(contents?.[title]?.std).toBe(4);
//     expect(contents?.[title]?.mean).toBe(5);
//   });

//   it("should create new experiment (type: MonteCarlo, distribution: log-normal)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     // distribution selection
//     const distributionDropdown = screen.getByText("normal").nextSibling;
//     userEvent.click(distributionDropdown as TargetElement);
//     const logNormalElement = screen.getByText("log-normal");
//     userEvent.click(logNormalElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const muInput = screen.getByTestId("input-montecarlo-lognormal-mu");
//     const sigmaInput = screen.getByTestId("input-montecarlo-lognormal-sigma");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(muInput, "{backspace}4");
//     userEvent.type(sigmaInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("log-normal");
//     expect(contents?.[title]?.mu).toBe(4);
//     expect(contents?.[title]?.sigma).toBe(5);
//   });

//   it("should create new experiment (type: MonteCarlo, distribution: poisson)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     // distribution selection
//     const distributionDropdown = screen.getByText("normal").nextSibling;
//     userEvent.click(distributionDropdown as TargetElement);
//     const logNormalElement = screen.getByText("poisson");
//     userEvent.click(logNormalElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const rateInput = screen.getByTestId("input-montecarlo-poisson-rate");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(rateInput, "{backspace}4");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("poisson");
//     expect(contents?.[title]?.rate).toBe(4);
//   });

//   it("should create new experiment (type: MonteCarlo, distribution: beta)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     // distribution selection
//     const distributionDropdown = screen.getByText("normal").nextSibling;
//     userEvent.click(distributionDropdown as TargetElement);
//     const betaElement = screen.getByText("beta");
//     userEvent.click(betaElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const alphaInput = screen.getByTestId("input-montecarlo-beta-alpha");
//     const betaInput = screen.getByTestId("input-montecarlo-beta-beta");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(alphaInput, "{backspace}4");
//     userEvent.type(betaInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("beta");
//     expect(contents?.[title]?.alpha).toBe(4);
//     expect(contents?.[title]?.beta).toBe(5);
//   });

//   it("should create new experiment (type: MonteCarlo, distribution: gamma)", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     // distribution selection
//     const distributionDropdown = screen.getByText("normal").nextSibling;
//     userEvent.click(distributionDropdown as TargetElement);
//     const betaElement = screen.getByText("gamma");
//     userEvent.click(betaElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const alphaInput = screen.getByTestId("input-montecarlo-gamma-shape");
//     const betaInput = screen.getByTestId("input-montecarlo-gamma-scale");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(alphaInput, "{backspace}4");
//     userEvent.type(betaInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("gamma");
//     expect(contents?.[title]?.shape).toBe(4);
//     expect(contents?.[title]?.scale).toBe(5);
//   });

//   it("should discard and leave experiments.json intact", () => {
//     store.dispatch(setProjectWithMeta(mockProject));
//     const mockFn = jest.fn();
//     render(
//       <Provider store={store}>
//         <ModalProvider>
//           <ExperimentModal onClose={mockFn} />
//         </ModalProvider>
//       </Provider>
//     );
//     const typeDropdown = screen.getByText("Value sweeping").nextSibling;
//     const titleInput = screen.getByPlaceholderText("Experiment title");
//     const submitButton = screen.getByText("Create experiment");
//     const title = "Wonderful title";
//     userEvent.click(typeDropdown as TargetElement);
//     const arangeElement = screen.getByText("Monte Carlo sweeping");
//     userEvent.click(arangeElement);
//     // distribution selection
//     const distributionDropdown = screen.getByText("normal").nextSibling;
//     userEvent.click(distributionDropdown as TargetElement);
//     const betaElement = screen.getByText("gamma");
//     userEvent.click(betaElement);
//     userEvent.type(titleInput, title);
//     const fieldDropdown = screen.getByText("FIELD").parentElement?.nextSibling;
//     userEvent.click(fieldDropdown as TargetElement);
//     userEvent.type(fieldDropdown as TargetElement, "{arrowdown}");
//     const firstFieldDropdown = screen.getByText("onion");
//     userEvent.click(firstFieldDropdown);
//     // // these 3 inputs are only visible _after_ we select Arange Sweeping
//     const samplesInput = screen.getByTestId("input-montecarlo-samples");
//     const alphaInput = screen.getByTestId("input-montecarlo-gamma-shape");
//     const betaInput = screen.getByTestId("input-montecarlo-gamma-scale");
//     userEvent.type(samplesInput, "{backspace}3");
//     userEvent.type(alphaInput, "{backspace}4");
//     userEvent.type(betaInput, "{backspace}5");
//     userEvent.click(submitButton);
//     expect(mockFn).toHaveBeenCalled();
//     const state = store.getState();
//     const contents: any = JSON.parse(
//       state?.files?.entities?.experiments?.contents || ""
//     );
//     expect(contents?.[title]?.type).toBe("monte-carlo");
//     expect(contents?.[title]?.steps).toBe(100);
//     expect(contents?.[title]?.field).toBe("onion");
//     expect(contents?.[title]?.samples).toBe(3);
//     expect(contents?.[title]?.distribution).toBe("gamma");
//     expect(contents?.[title]?.shape).toBe(4);
//     expect(contents?.[title]?.scale).toBe(5);
//   });

//   it.todo("Edit: should not delete everything after saving");
// });
