import React, { FC, HTMLProps, ReactNode } from "react";
import Popover, { ArrowContainer, PopoverProps } from "react-tiny-popover";
import classNames from "classnames";

import "./BehaviorKeysFieldPopover.css";

export const BehaviorKeysFieldPopover: FC<
  Pick<PopoverProps, "isOpen" | "onClickOutside" | "children"> & {
    type?: string;
    content: ReactNode;
  } & Omit<HTMLProps<HTMLDivElement>, "content">
> = ({
  isOpen,
  onClickOutside,
  type,
  children,
  content,
  className,
  ...props
}) => (
  <Popover
    isOpen={isOpen}
    position={["bottom", "top", "right", "left"]}
    transitionDuration={0}
    onClickOutside={onClickOutside}
    containerClassName="react-tiny-popover-container BehaviorKeys__PopoverContainer"
    content={({ popoverRect, position, targetRect }) => (
      <ArrowContainer
        position={position}
        targetRect={targetRect}
        popoverRect={popoverRect}
        arrowColor="var(--BehaviorKeys__Popover--background)"
        arrowSize={10}
      >
        <div
          {...props}
          className={classNames(
            "BehaviorKeys__Popover",
            { [`BehaviorKeys__Popover--${type}`]: !!type },
            className
          )}
        >
          {content}
        </div>
      </ArrowContainer>
    )}
  >
    {children}
  </Popover>
);
