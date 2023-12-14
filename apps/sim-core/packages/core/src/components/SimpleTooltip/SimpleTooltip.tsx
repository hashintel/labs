import React, {
  FC,
  HTMLProps,
  Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { unstable_batchedUpdates } from "react-dom";
import Popover from "react-tiny-popover";
import * as CSS from "csstype";
import classNames from "classnames";

import { SimpleTooltipContext } from "./context";
import { useCanHover } from "../../hooks/useCanHover";
import { useRefState } from "../../hooks/useRefState";

import "./SimpleTooltip.css";

export type SimpleTooltipProps = {
  position: "above" | "below";
  allRoundedBorders?: boolean;
  align?: "right" | "left";
  flatLeft?: boolean;
  flatRight?: boolean;
  inModal?: boolean;
  containerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  tooltipRef?: Ref<HTMLDivElement>;
  interactive?: boolean;
  persistent?: boolean;
} & Pick<HTMLProps<HTMLDivElement>, "style" | "className">;

type ClickedType = "inactive" | "clicked" | "unclicked";

const clickedToOpen = (clicked: ClickedType) => {
  switch (clicked) {
    case "clicked":
      return true;
    case "unclicked":
      return false;
    default:
      return null;
  }
};

const defaultClickedState = "inactive" as const;

export const SimpleTooltip: FC<SimpleTooltipProps> = ({
  position,
  allRoundedBorders,
  align = "left",
  children,
  className,
  flatLeft,
  flatRight,
  containerClassName,
  inModal = false,
  style,
  onOpenChange,
  tooltipRef,
  interactive = false,
  persistent,
}) => {
  const popoverRef = useRef<Popover>(null);
  const [open, setOpen, openRef] = useRefState(false);
  const [clicked, setClicked, clickedRef] =
    useRefState<ClickedType>(defaultClickedState);
  const [width, setWidth] = useState(0);

  if (clicked !== defaultClickedState && !persistent) {
    setClicked(defaultClickedState);
  }

  const onOpenChangeRef = useRef(onOpenChange);

  useLayoutEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const childRef = useRef<HTMLDivElement>(null);

  const isTargetWithinParent = useCallback(
    (target: HTMLElement) => {
      const parent = childRef.current?.parentNode as HTMLElement;
      const tooltip = (popoverRef.current as any).popoverDiv as HTMLElement;

      return (
        target === parent ||
        parent.contains(target) ||
        (interactive &&
          openRef.current &&
          (target === tooltip || !!tooltip?.contains(target)))
      );
    },
    [interactive, openRef],
  );

  const openTooltip = useCallback(() => {
    const parent = childRef.current?.parentNode as HTMLElement;

    setOpen(true);
    setWidth(parent.offsetWidth);
    onOpenChangeRef.current?.(true);
  }, [setOpen]);

  const closeTooltip = useCallback(() => {
    setOpen(false);

    if (clickedRef.current === "clicked") {
      setClicked("inactive");
    }

    onOpenChangeRef.current?.(false);
  }, [clickedRef, setClicked, setOpen]);

  const canHover = useCanHover();
  const enabled = canHover || interactive;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const parent = childRef.current?.parentNode as HTMLElement;
    setWidth(parent.offsetWidth);

    if (parent) {
      let req: null | ReturnType<typeof requestAnimationFrame> = null;

      const mouseEvent = (evt: MouseEvent | TouchEvent) => {
        const target = evt.target as HTMLElement;
        const clickedOpenState: boolean | null = clickedToOpen(
          clickedRef.current,
        );

        const withinParent = isTargetWithinParent(target);
        const open = clickedOpenState ?? withinParent;

        if (clickedRef.current === "unclicked" && !withinParent) {
          setClicked("inactive");
        }

        if (open && req) {
          cancelAnimationFrame(req);
          req = null;
        }

        if (open !== openRef.current) {
          if (open) {
            openTooltip();
          } else {
            req = requestAnimationFrame(() => {
              closeTooltip();
            });
          }
        }
      };

      const clicked = () => {
        if (persistent) {
          unstable_batchedUpdates(() => {
            if (clickedRef.current === "clicked") {
              setClicked("unclicked");
              closeTooltip();
            } else {
              setClicked("clicked");
              openTooltip();
            }
          });
        }
      };

      document.body.addEventListener("mouseover", mouseEvent);
      document.body.addEventListener("touchend", mouseEvent);
      parent.addEventListener("mouseenter", mouseEvent);
      parent.addEventListener("mouseleave", mouseEvent);
      parent.addEventListener("click", clicked);

      return () => {
        parent.classList.remove("SimpleTooltip-Parent");
        document.body.removeEventListener("mouseover", mouseEvent);
        document.body.removeEventListener("touchend", mouseEvent);
        parent.removeEventListener("mouseenter", mouseEvent);
        parent.removeEventListener("mouseleave", mouseEvent);
        parent.removeEventListener("click", clicked);
      };
    }
  }, [
    clickedRef,
    closeTooltip,
    openRef,
    openTooltip,
    persistent,
    setClicked,
    isTargetWithinParent,
    enabled,
  ]);

  useLayoutEffect(() => {
    const parent = childRef.current?.parentNode as HTMLElement | undefined;

    parent?.classList.add("SimpleTooltip-Parent");

    if (open) {
      // Private method unfortunately
      (popoverRef.current as any)?.renderPopover();
    }

    return () => {
      parent?.classList.remove("SimpleTooltip-Parent");
    };
  });

  if (!enabled) {
    return null;
  }

  return (
    <>
      <Popover
        ref={popoverRef}
        align={align === "left" ? "start" : "end"}
        disableReposition
        padding={0}
        position={[position === "above" ? "top" : "bottom"]}
        isOpen={open}
        transitionDuration={0}
        containerClassName={classNames(
          "react-tiny-popover-container SimpleTooltipPopover-container",
          containerClassName,
          {
            "SimpleTooltipPopover-container--noInteractive": !interactive,
          },
          {
            Modal__Tooltip: inModal,
          },
        )}
        content={
          <div
            ref={tooltipRef}
            className={classNames([
              "SimpleTooltip",
              `SimpleTooltip-position-${position}`,
              `SimpleTooltip-align-${align}`,
              {
                "SimpleTooltip-all-rounded-borders": allRoundedBorders,
              },
              {
                "SimpleTooltip--flatLeft": flatLeft,
                "SimpleTooltip--flatRight": flatRight,
              },
              className,
            ])}
            style={
              {
                ...(style ?? {}),
                ["--tooltip-helper-width"]: `${width}px`,
              } as CSS.Properties
            }
            onClick={(evt) => {
              evt.stopPropagation();
            }}
          >
            {open ? (
              <SimpleTooltipContext.Provider value={closeTooltip}>
                {children}
              </SimpleTooltipContext.Provider>
            ) : null}
          </div>
        }
      >
        <div className="SimpleTooltip-PositionHelper" />
      </Popover>
      <div ref={childRef} style={{ display: "none" }} />
    </>
  );
};
