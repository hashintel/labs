import { Store } from "@reduxjs/toolkit";

import { RootState } from "./types";
import { autoSaveSubscribe } from "./subscribers/autoSaveSubscribe";

export const subscribe = (store: Store<RootState>) => {
  autoSaveSubscribe(store);
};
