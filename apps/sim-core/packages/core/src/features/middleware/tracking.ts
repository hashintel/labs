import { Middleware, PayloadAction } from "@reduxjs/toolkit";

import type { AppDispatch, RootState } from "../types";
import { changeTab, selectVisibleTabsInOrder } from "../viewer";
import { trackEvent } from "../analytics";

const payloadByAction = (state: RootState, action: PayloadAction<any>) => {
  switch (action.type) {
    case changeTab.type:
      return {
        action: "Viewer Tab Change",
        label: selectVisibleTabsInOrder(state)[action.payload].name,
      };
    /**
     * TODO @mysterycommand these are fired by `useModalNameBehavior`, through
     * it's `onSubmit` argument, but they're all `AppThunk`s so they don't
     * directly dispatch an action, use `createAsyncThunk` or pull the last
     * action from the thunk?
     *
     * @see packages/core/src/components/HashCore/Files/hooks/useModalNameBehavior.tsx
     * @see packages/core/src/components/FileBanner/Shared/FileBannerShared.tsx
     * @see packages/core/src/components/HashCore/Files/hooks/useNameNewBehaviorModal.ts
     * @see packages/core/src/components/HashCore/Files/hooks/useRenameBehaviorModal.ts
     */
    // case forkOpenBehavior:
    // case newBehavior:
    // case updateFileAndSave:
    //   return {
    //     action: "",
    //     label: ""
    //   };
  }
};
export const trackingMiddleware: Middleware<{}, RootState> = (store) => {
  const dispatch = store.dispatch as AppDispatch;

  return (next) => (action) => {
    const result = next(action);
    const payload = payloadByAction(store.getState(), action);

    if (payload) {
      dispatch(trackEvent({ action: payload.action, label: payload.label }));
    }

    return result;
  };
};
