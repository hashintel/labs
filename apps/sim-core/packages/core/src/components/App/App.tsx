import React, { FC } from "react";
import { Provider } from "react-redux";
import { ModalProvider } from "react-modal-hook";
import { Store } from "@reduxjs/toolkit";
import { RecoilRoot } from "recoil";

import { ErrorBoundary } from "../ErrorBoundary";
import { FontsPreloader } from "../FontsPreloader";
import { MonacoContainerProvider } from "../TabbedEditor/hooks";
import { SimulatorProvider } from "../../features/simulator/context";

import "./App.css";

type AppProps = {
  store: Store;
};

export const App: FC<AppProps> = ({ store, children }) => (
  <RecoilRoot>
    <ErrorBoundary>
      <Provider store={store}>
        <SimulatorProvider>
          <ModalProvider>
            <FontsPreloader>
              <MonacoContainerProvider>
                <div className="App">{children}</div>
              </MonacoContainerProvider>
            </FontsPreloader>
          </ModalProvider>
        </SimulatorProvider>
      </Provider>
    </ErrorBoundary>
  </RecoilRoot>
);
