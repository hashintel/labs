import React, { FC, PropsWithChildren } from "react";

import { Toast } from ".";
import { ToastKind } from "../../features/toast/enums";
import type { ToastProps } from "./types";
import { useToast } from "../../features/toast/ToastContext";

type SimulationToastProps = Pick<ToastProps, "theme" | "isDismissable"> & {
  nextToast?: ToastKind;
};

export const SimulationToast: FC<PropsWithChildren<SimulationToastProps>> = ({
  theme = "info",
  isDismissable = true,
  children,
  nextToast = ToastKind.None,
}) => {
  const { displayToast } = useToast();
  const dismiss = () => displayToast({ kind: nextToast });

  return (
    <Toast theme={theme} isDismissable={isDismissable} dismiss={dismiss}>
      {children}
    </Toast>
  );
};
