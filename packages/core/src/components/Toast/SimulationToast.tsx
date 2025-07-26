import React, { FC } from "react";
import { useDispatch } from "react-redux";

import { Toast } from ".";
import { ToastKind } from "../../features/toast/enums";
import type { ToastProps } from "./types";
import { displayToast } from "../../features/toast/slice";

type SimulationToastProps = Pick<ToastProps, "theme" | "isDismissable"> & {
  nextToast?: ToastKind;
};

export const SimulationToast: FC<SimulationToastProps> = ({
  theme = "info",
  isDismissable = true,
  children,
  nextToast = ToastKind.None,
}) => {
  const dispatch = useDispatch();
  const dismiss = () => dispatch(displayToast({ kind: nextToast }));

  return (
    <Toast theme={theme} isDismissable={isDismissable} dismiss={dismiss}>
      {children}
    </Toast>
  );
};
