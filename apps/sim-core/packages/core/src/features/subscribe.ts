import { Store } from "@reduxjs/toolkit";

import { RootState } from "./types";
import { autoSaveSubscribe } from "./subscribers/autoSaveSubscribe";
import { subscribe as monacoSubscribe } from "./monaco";

export const subscribe = (store: Store<RootState>) => {
  monacoSubscribe(store);
  autoSaveSubscribe(store);
};
