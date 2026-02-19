import React, { FC, PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";
import { Store } from "@reduxjs/toolkit";

import { ErrorBoundary } from "../ErrorBoundary";
import { ExamplesProvider } from "../../features/examples/ExamplesContext";
import { FilesProvider } from "../../features/files/FilesContext";
import { FontsPreloader } from "../FontsPreloader";
import { ProjectProvider } from "../../features/project/ProjectContext";
import { MonacoContainerProvider } from "../TabbedEditor/hooks";
import { SceneProvider } from "../AgentScene/state/SceneContext";
import { SearchProvider } from "../../features/search/SearchContext";
import { SimulatorProvider } from "../../features/simulator/context";
import { ToastProvider } from "../../features/toast/ToastContext";
import { UserProvider } from "../../features/user/UserContext";
import { ViewerProvider } from "../../features/viewer/ViewerContext";

import "./App.css";

type AppProps = PropsWithChildren<{
  store: Store;
}>;

/**
 * Provider ordering: ProjectProvider is below Viewer, Toast, Files so it can
 * coordinate setProjectWithMeta across those contexts. Redux Provider is kept
 * temporarily until all Redux code is removed.
 */
export const App: FC<AppProps> = ({ store, children }) => (
  <ErrorBoundary>
    <Provider store={store}>
    <UserProvider>
    <ExamplesProvider>
    <ViewerProvider>
    <ToastProvider>
    <FilesProvider>
    <ProjectProvider>
    <SearchProvider>
      <SceneProvider>
        <SimulatorProvider>
        <ModalProvider>
          <FontsPreloader>
            <MonacoContainerProvider>
              <div className="App">{children}</div>
            </MonacoContainerProvider>
          </FontsPreloader>
        </ModalProvider>
        </SimulatorProvider>
      </SceneProvider>
    </SearchProvider>
    </ProjectProvider>
    </FilesProvider>
    </ToastProvider>
    </ViewerProvider>
    </ExamplesProvider>
    </UserProvider>
    </Provider>
  </ErrorBoundary>
);
