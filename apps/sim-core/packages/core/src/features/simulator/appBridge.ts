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
  _files: {} as any,
  _project: {} as any,
  _viewer: { editor: true, currentTab: "3d" } as any,
  _snapshot: null as any,

  getState(): any {
    if (!appBridge._snapshot) {
      appBridge._snapshot = {
        files: appBridge._files,
        project: appBridge._project,
        viewer: appBridge._viewer,
      };
    }
    return appBridge._snapshot;
  },

  setState(next: { files?: any; project?: any; viewer?: any }) {
    if (next.files !== undefined) appBridge._files = next.files;
    if (next.project !== undefined) appBridge._project = next.project;
    if (next.viewer !== undefined) appBridge._viewer = next.viewer;
    appBridge._snapshot = null;
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

if (typeof window !== "undefined") {
  (window as any).__appBridge = appBridge;
}
