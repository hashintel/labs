import { createEntityAdapter } from "@reduxjs/toolkit";

import type { HcFile } from "./types";
import { fileSorter } from "./utils";

export const {
  getInitialState,
  addOne,
  addMany,
  updateOne,
  updateMany,
  upsertOne,
  upsertMany,
  removeOne,
  removeMany,
  getSelectors,
} = createEntityAdapter<HcFile>({
  sortComparer: fileSorter,
});
