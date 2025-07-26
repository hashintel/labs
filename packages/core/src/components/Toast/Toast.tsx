import React, { FC } from "react";

import { IconClose } from "../Icon";
import type { ToastProps } from "./types";

import "./Toast.css";

export const Toast: FC<ToastProps> = ({
  theme = "info",
  isDismissable = true,
  dismiss,
  children,
}) => {
  return (
    <div className={`Toast Toast-${theme}`}>
      <div className="Toast-content-spacer" aria-hidden />
      {children}
      {isDismissable && (
        <>
          <div className="Toast-dismiss-spacer" aria-hidden />
          <button className="Toast-dismiss" onClick={dismiss}>
            <IconClose />
          </button>
        </>
      )}
    </div>
  );
};
