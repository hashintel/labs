import React, { FC, PropsWithChildren } from "react";
import { ModalProvider } from "react-modal-hook";

import { ErrorBoundary } from "../ErrorBoundary";
import { ExamplesProvider } from "../../features/examples/ExamplesContext";
import { FilesProvider } from "../../features/files/FilesContext";
import { FontsPreloader } from "../FontsPreloader";
import { ProjectProvider } from "../../features/project/ProjectContext";
import { MonacoContainerProvider } from "../TabbedEditor/hooks";
import { SceneProvider } from "../AgentScene/state/SceneContext";
import { SearchProvider } from "../../features/search/SearchContext";
import { SimulatorProvider } from "../../features/simulator/context";
import { StoreSync } from "../../features/simulator/simulate/StoreSync";
import { ToastProvider } from "../../features/toast/ToastContext";
import { UserProvider } from "../../features/user/UserContext";
import { ViewerProvider } from "../../features/viewer/ViewerContext";

import "./App.css";

/**
 * Provider ordering: ProjectProvider is below Viewer, Toast, Files so it can
 * coordinate setProjectWithMeta across those contexts. The simulator keeps
 * its own Redux store for performance; StoreSync bridges app contexts to it.
 */
export const App: FC<PropsWithChildren> = ({ children }) => (
  <ErrorBoundary>
  <UserProvider>
  <ExamplesProvider>
  <ViewerProvider>
  <ToastProvider>
  <FilesProvider>
  <ProjectProvider>
  <SearchProvider>
    <SceneProvider>
      <SimulatorProvider>
      <StoreSync />
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
  </ErrorBoundary>
);
