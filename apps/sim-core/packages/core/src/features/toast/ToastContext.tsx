/**
 * Facade over the Redux toast slice. Consumers use `useToast()` instead of
 * `useSelector`/`useDispatch`. Internally still reads from Redux until all
 * slices are migrated.
 */
import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useDispatch, useSelector } from "react-redux";

import { ToastKind } from "./enums";
import type { ToastSlice } from "./types";
import { displayToast as displayToastAction } from "./slice";
import { selectToastData, selectToastKind } from "./selectors";

export interface ToastContextValue {
  toastKind: ToastKind;
  toastData: any;
  displayToast: (toast: ToastSlice) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
};

export const ToastProvider: FC<PropsWithChildren> = ({ children }) => {
  const dispatch = useDispatch();
  const toastKind = useSelector(selectToastKind);
  const toastData = useSelector(selectToastData);

  const displayToast = useCallback(
    (toast: ToastSlice) => dispatch(displayToastAction(toast)),
    [dispatch],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toastKind, toastData, displayToast }),
    [toastKind, toastData, displayToast],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};
