import { enableMapSet } from "immer";

import * as api from "./util/api";
import { buildSimulationProvider } from "./features/simulator/simulate/buildprovider";
import { configureMonaco } from "./util/monaco-config";
import { initSentry } from "./util/initSentry";
import { resizeObserverPromise } from "./util/resizeObserverPromise";
import { simulatorStore } from "./features/simulator/store";
import { store } from "./features/store";
import { syncStores } from "./features/simulator/simulate/sync";
import { theme } from "./util/theme";

const configureTheme = () => {
  const { style } = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    style.setProperty(`--theme-${key}`, value);
  }
};

export const boot = async (forExperiments: boolean) => {
  // Expose for console access:
  Object.assign(window as any, {
    api,
    store,
    simulatorStore,
  });

  initSentry();
  configureTheme();
  enableMapSet();
  configureMonaco();
  buildSimulationProvider(forExperiments);
  syncStores(store, simulatorStore);

  await resizeObserverPromise;
};
