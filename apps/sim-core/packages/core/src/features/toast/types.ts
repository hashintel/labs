import { ToastKind } from "./enums";

export interface ToastSlice {
  kind: ToastKind;
  data?: any;
}
