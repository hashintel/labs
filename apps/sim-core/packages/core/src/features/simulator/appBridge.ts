import type { UserAlert } from "../viewer/types";

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Mutable bridge object that StoreSync populates with current app state.
 * Simulator code that previously imported from the app Redux store reads
 * from here instead. StoreSync.tsx keeps these values in sync with the
 * React context state.
 *
 * Also implements a minimal store-like subscribe/getState API so that
 * fromStore() can create RxJS observables from it.
 */
export const appBridge = {
  _state: {
    files: {} as any,
    project: {} as any,
    viewer: { editor: true, currentTab: "3d" } as any,
  },

  getState(): any {
    return appBridge._state;
  },

  setState(next: { files?: any; project?: any; viewer?: any }) {
    if (next.files !== undefined) appBridge._state.files = next.files;
    if (next.project !== undefined) appBridge._state.project = next.project;
    if (next.viewer !== undefined) appBridge._state.viewer = next.viewer;
    listeners.forEach((fn) => fn());
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  dispatchUserAlert: (_alert: UserAlert) => {},
  dispatchClearUserAlerts: () => {},
  dispatchOpenTab: (_tab: any) => {},
  dispatchTrackEvent: (_event: any) => {},
  dispatchTrackEvents: (_events: any[]) => {},
};
