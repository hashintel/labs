import React, { FC, PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";
import { Store } from "@reduxjs/toolkit";

import { ErrorBoundary } from "../ErrorBoundary";
import { ExamplesProvider } from "../../features/examples/ExamplesContext";
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

export const App: FC<AppProps> = ({ store, children }) => (
  <ErrorBoundary>
    <Provider store={store}>
      <UserProvider>
      <ProjectProvider>
      <ExamplesProvider>
      <SimulatorProvider>
        <SceneProvider>
          <ViewerProvider>
          <SearchProvider>
          <ToastProvider>
          <ModalProvider>
            <FontsPreloader>
              <MonacoContainerProvider>
                <div className="App">{children}</div>
              </MonacoContainerProvider>
            </FontsPreloader>
          </ModalProvider>
          </ToastProvider>
          </SearchProvider>
          </ViewerProvider>
        </SceneProvider>
      </SimulatorProvider>
      </ExamplesProvider>
      </ProjectProvider>
      </UserProvider>
    </Provider>
  </ErrorBoundary>
);
