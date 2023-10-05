import type { RootReducerType } from "./rootReducer";
import type { StoreType } from "./store";

export type RootState = ReturnType<RootReducerType>;
export type AppDispatch = StoreType["dispatch"];

export type AppThunk<ReturnValueType = void> = (
  dispatch: AppDispatch,
  getState: () => RootState,
  extraArgument: unknown
) => ReturnValueType;

export type AsyncAppThunk<ReturnValueType = void> = AppThunk<
  Promise<ReturnValueType>
>;

export type AppAsyncThunkArgs = { state: RootState; dispatch: AppDispatch };
