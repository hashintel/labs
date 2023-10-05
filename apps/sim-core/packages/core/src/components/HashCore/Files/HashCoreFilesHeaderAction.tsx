import React, {
  ButtonHTMLAttributes,
  FC,
  RefObject,
  useRef,
  useState,
} from "react";
import classNames from "classnames";

import { SimpleTooltip } from "../../SimpleTooltip";

import "./HashCoreFilesHeaderAction.scss";

export const HashCoreFilesHeaderAction: FC<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    paneRef?: RefObject<HTMLDivElement | null>;
  }
> = ({ title, children, className, paneRef, ...props }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<"left" | "right">("left");

  const onTooltipOpenChange = (open: boolean) => {
    if (open) {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      const pane = paneRef?.current;

      if (!button || !tooltip || !pane) {
        return;
      }

      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const max = pane.getBoundingClientRect().width;
      const farRight = buttonRect.left + tooltipRect.width;

      if (position === "left") {
        if (farRight >= max) {
          setPosition("right");
        }
      } else {
        const farLeft = buttonRect.left + buttonRect.width - tooltipRect.width;

        if (farRight < max || farLeft <= 0) {
          setPosition("left");
        }
      }
    }
  };

  return (
    <li>
      <button
        ref={buttonRef}
        className={classNames(
          "HashCoreFilesHeaderAction",
          {
            "HashCoreFilesHeaderAction--right": position === "right",
            "HashCoreFilesHeaderAction--left": position === "left",
          },
          className
        )}
        {...props}
      >
        {children}

        <SimpleTooltip
          position="below"
          align={position}
          className="HashCoreFilesHeaderActionTooltip"
          onOpenChange={onTooltipOpenChange}
          tooltipRef={tooltipRef}
        >
          {title}
        </SimpleTooltip>
      </button>
    </li>
  );
};
