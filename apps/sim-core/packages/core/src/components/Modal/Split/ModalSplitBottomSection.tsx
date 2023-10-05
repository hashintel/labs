import React, { forwardRef, HTMLProps } from "react";
import classNames from "classnames";

import "./ModalSplitBottomSection.scss";

export const ModalSplitBottomSection = forwardRef<
  HTMLDivElement,
  HTMLProps<HTMLDivElement> & {
    small?: boolean;
    scrollable?: boolean;
    flex?: boolean;
    divide?: boolean;
  }
>(
  (
    { className, children, small, scrollable, flex, divide = true, ...props },
    ref
  ) => (
    <div
      className={classNames(
        "ModalSplitBottomSection",
        {
          "ModalSplitBottomSection--small": small,
          "ModalSplitBottomSection--scrollable": scrollable,
          "ModalSplitBottomSection--flex": flex,
          "ModalSplitBottomSection--divide": divide,
        },
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </div>
  )
);
