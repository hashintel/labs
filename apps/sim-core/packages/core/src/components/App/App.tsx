import React, { FC, PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";
import { Store } from "@reduxjs/toolkit";

import { ErrorBoundary } from "../ErrorBoundary";
import { FontsPreloader } from "../FontsPreloader";
import { MonacoContainerProvider } from "../TabbedEditor/hooks";
import { SceneProvider } from "../AgentScene/state/SceneContext";
import { SearchProvider } from "../../features/search/SearchContext";
import { SimulatorProvider } from "../../features/simulator/context";
import { ViewerProvider } from "../../features/viewer/ViewerContext";

import "./App.css";

type AppProps = PropsWithChildren<{
  store: Store;
}>;

export const App: FC<AppProps> = ({ store, children }) => (
  <ErrorBoundary>
    <Provider store={store}>
      <SimulatorProvider>
        <SceneProvider>
          <ViewerProvider>
          <SearchProvider>
          <ModalProvider>
            <FontsPreloader>
              <MonacoContainerProvider>
                <div className="App">{children}</div>
              </MonacoContainerProvider>
            </FontsPreloader>
          </ModalProvider>
          </SearchProvider>
          </ViewerProvider>
        </SceneProvider>
      </SimulatorProvider>
    </Provider>
  </ErrorBoundary>
);
