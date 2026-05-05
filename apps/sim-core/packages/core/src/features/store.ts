import { configureStore, isPlain } from "@reduxjs/toolkit";

import { RootState } from "./types";
import { analysisMiddleware } from "./middleware/analysis";
import { localStorageMiddleware } from "./middleware/localStorage";
import { observeMiddleware } from "./utils";
import { queueMiddleware } from "./middleware/queue";
import { rootReducer } from "./rootReducer";
import { storeActionObservable } from "./actionObservable";
import { subscribe } from "./subscribe";
import { trackingMiddleware } from "./middleware";

/**
 * there's no Redux DevTools extension for Safari, but this middleware is a
 * start at replicating that functionality:
 *
 * ```ts
 * middleware: getDefaultMiddleware =>
 *   getDefaultMiddleware().concat(store => next => action => {
 *     console.log(action.type, store.getState());
 *     return next(action);
 *   })
 * ```
 */

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        /**
         * We want to be able to handle errors at our dispatch site – so we need
         * to allow errors to appear inside our actions
         */
        isSerializable: (value: any) =>
          value instanceof Error || isPlain(value),
      },
    })
      /**
       * queueMiddleware needs to be the first middleware, because its special
       * actions are not compatible with built in middleware (as they contain
       * non-serializable values). This is fine as these actions are just
       * instructions to the middleware and they never reach reducers or dev
       * tools. This is the same approach redux toolkit takes to thunk.
       */
      .prepend([queueMiddleware])
      .concat([
        localStorageMiddleware,
        trackingMiddleware,
        analysisMiddleware,
        observeMiddleware<RootState>(storeActionObservable),
      ]),
});

export type StoreType = typeof store;

subscribe(store);

/**
 * this would be cool but `Property 'hot' does not exist on type 'NodeModule'.`
 */
// if (process.env.NODE_ENV === "development" && module.hot) {
//   module.hot.accept("./rootReducer", () => {
//     const nextRootReducer = require("./rootReducer").default;
//     store.replaceReducer(nextRootReducer);
//   });
// }
