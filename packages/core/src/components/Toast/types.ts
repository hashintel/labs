import { MouseEventHandler } from "react";

export type ToastTheme =
  | "success" // "green"
  | "warning" // "yellow"
  | "error" // "red"
  | "info"; // "white"

export interface ToastProps {
  theme?: ToastTheme;
  isDismissable?: boolean;
  dismiss: MouseEventHandler<HTMLButtonElement>;
}
