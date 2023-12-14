import React, { Context, createContext, FC } from "react";
import {
  createDispatchHook,
  createSelectorHook,
  createStoreHook,
  Provider,
  ReactReduxContextValue,
} from "react-redux";

import type { SimulatorDispatch, SimulatorRootState } from "./types";
import { simulatorStore } from "./store";

/**
 *
 * We'd lke to use Redux for simulation state because of the filtering, selecting,
 * and dispatching niceties it brings us, but we run into a performance area where
 * it makes sense to make a dedicated store rather than just a slice. This store
 * can be stripped down to be as performant as possible and allow us to hook into
 * pending/rejected runner messages without clogging up the primary store.
 *
 * "There are edge cases when you might use multiple stores (e.g. if you have
 *  performance problems with updating lists of thousands of items that are on
 *  screen at the same time many times per second). That said it's an exception
 *  and in most apps you never need more than a single store."
 *
 * https://stackoverflow.com/a/33633850
 *
 */
const SimulatorReduxContext: Context<
  ReactReduxContextValue<SimulatorRootState>
> = createContext(null) as any;

export const useSimulatorStore: () => typeof simulatorStore = createStoreHook(
  SimulatorReduxContext,
);

export const useSimulatorSelector: <TSelected = unknown>(
  selector: (state: SimulatorRootState) => TSelected,
  equalityFn?: (left: TSelected, right: TSelected) => boolean,
) => TSelected = createSelectorHook(SimulatorReduxContext);

export const useSimulatorDispatch: () => SimulatorDispatch = createDispatchHook(
  SimulatorReduxContext,
);

export const SimulatorProvider: FC = ({ children }) => (
  <Provider store={simulatorStore} context={SimulatorReduxContext}>
    {children}
  </Provider>
);
