import React, { FC, useEffect, useMemo, useRef, useState } from "react";

import { getDomIdByFileId } from "../../Files/ListItemFile";
import { pauseSimulator } from "../../../../features/simulator/simulate/slice";
import {
  selectCurrentSimulationId,
  selectRunning,
} from "../../../../features/simulator/simulate/selectors";
import { useResizeObserver } from "../../../../hooks/useResizeObserver/useResizeObserver";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";
import { useTour } from "../react-shepherd-wrapper";

function getScrollParent(node: HTMLElement): HTMLElement {
  if (node === document.body || node.scrollHeight > node.clientHeight) {
    return node;
  } else {
    return getScrollParent(node.parentNode as HTMLElement);
  }
}

/**
 * @todo  Couldn't figure out how to animate out when slide changes
 *        within React lifecycles. Rendering manually instead
 * @todo  Rewrite this
 */
export const Indicator: FC<{
  element: HTMLElement | null | undefined;
  show: boolean;
  position: "left-overlap" | "right-overlap" | "right";
}> = ({ element, show, position }) => {
  const calculateRef = useRef<VoidFunction | null>(null);
  const immediateIdRef = useRef<number | null>(null);

  const calculateOnResize = () => {
    if (immediateIdRef.current !== null) {
      clearTimeout(immediateIdRef.current);
    }

    immediateIdRef.current = setTimeout(() => calculateRef.current?.());
  };

  const setTargetObserverRef = useResizeObserver(calculateOnResize, {
    onObserve: null,
  });
  const setElementParentObserverRef = useResizeObserver(calculateOnResize, {
    onObserve: null,
  });

  const indicator = useMemo(() => {
    const div = document.createElement("div");

    div.classList.add("HashCoreTour-Indicator");
    div.classList.add(`HashCoreTour-Indicator--dot`);

    return div;
  }, []);

  useEffect(() => {
    if (!element) {
      setTargetObserverRef(null);
      setElementParentObserverRef(null);
      calculateRef.current = null;

      return;
    }

    const target = getScrollParent(element);

    if (window.getComputedStyle(target).position === "static") {
      target.style.position = "relative";
    }

    calculateRef.current = () => {
      // We don't have scroll bars on the body – this prevents weird behavior
      if (target !== document.body) {
        target.scrollLeft = element.offsetLeft;
        target.scrollTop = element.offsetTop;
      }

      const elementRect = element.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const elementPosition = {
        top: elementRect.top - targetRect.top + target.scrollTop,
        left: elementRect.left - targetRect.left + target.scrollLeft,
      };

      // @todo abstract to function
      let left: number;
      let top: number;
      switch (position) {
        case "left-overlap":
          left = elementPosition.left - indicator.offsetWidth / 2;
          top = elementPosition.top - indicator.offsetHeight / 2;
          break;

        case "right-overlap":
          left =
            elementPosition.left +
            elementRect.width -
            indicator.offsetWidth / 2;
          top = elementPosition.top - indicator.offsetHeight / 2;
          break;

        case "right":
          left =
            elementPosition.left +
            elementRect.width -
            indicator.offsetWidth -
            15;
          top =
            elementPosition.top +
            (elementRect.height - indicator.offsetHeight) / 2;
          break;
      }

      Object.assign(indicator.style, {
        top: `${top}px`,
        left: `${left}px`,
      });
    };

    setTargetObserverRef(target);
    setElementParentObserverRef(element.offsetParent as HTMLElement | null);
    target.appendChild(indicator);
    calculateRef.current();
  }, [
    element,
    indicator,
    position,
    setElementParentObserverRef,
    setTargetObserverRef,
  ]);

  useEffect(() => {
    return () => {
      setElementParentObserverRef(null);
      setTargetObserverRef(null);

      indicator.addEventListener("transitionend", () => {
        indicator.remove();
      });

      indicator.classList.remove("HashCoreTour-Indicator--showing");
    };
  }, [indicator, setElementParentObserverRef, setTargetObserverRef]);

  useEffect(() => {
    const shouldShow = element && show;

    if (shouldShow) {
      calculateRef.current?.();
    }

    indicator.classList[shouldShow ? "add" : "remove"](
      "HashCoreTour-Indicator--showing",
    );
  }, [element, show, indicator]);

  return null;
};

export const PlayIndicator: FC<{ show: boolean }> = ({ show }) => {
  const element = useMemo(
    () => document.querySelector<HTMLElement>(".simulation-control.simulate"),
    [],
  );

  return <Indicator element={element} show={show} position="right-overlap" />;
};

export const ProgressIndicator: FC = () => {
  return (
    <div className="HashCoreTour-Progress">
      <div className="HashCoreTour-Progress-Indicator" />
    </div>
  );
};

export const Buttons: FC = ({ children }) => (
  <div className="shepherd-footer">{children}</div>
);

export const Button: FC<{
  type: "back" | "next";
  className?: string;
  disabled?: boolean;
}> = ({ type, className = "", disabled = false, children }) => {
  const tour = useTour();

  return (
    <button
      className={`shepherd-button ${className}`}
      disabled={disabled}
      onClick={
        disabled
          ? () => {}
          : (evt) => {
              evt.preventDefault();
              tour[type]();
            }
      }
    >
      {children}
    </button>
  );
};

export const BackButton: FC<{
  disabled?: boolean;
}> = ({ disabled }) => (
  <Button type="back" disabled={disabled} className="secondary">
    Back
  </Button>
);

export const useKeyboardSupport = (canGoBack = true, canGoForward = true) => {
  const tour = useTour();

  useEffect(() => {
    function listener(evt: KeyboardEvent) {
      switch (evt.key) {
        case "ArrowLeft":
          if (canGoBack) {
            evt.preventDefault();
            evt.stopImmediatePropagation();
            evt.stopPropagation();

            tour.back();
          }
          break;

        case "ArrowRight":
          if (canGoForward) {
            evt.preventDefault();
            evt.stopImmediatePropagation();
            evt.stopPropagation();

            tour.next();
          }
          break;
      }
    }

    document.body.addEventListener("keydown", listener);

    return () => {
      document.body.removeEventListener("keydown", listener);
    };
  }, [canGoBack, canGoForward, tour]);
};

export const KeyboardSupport: FC = () => {
  useKeyboardSupport(true, true);

  return null;
};

export const useOnSimulationPlay = (callback: VoidFunction, memo: any[]) => {
  const memoCallback = useMemo(() => callback, memo);
  const running = useSimulatorSelector(selectRunning);

  useEffect(() => {
    if (running) {
      memoCallback();
    }
  }, [memoCallback, running]);
};

export const useOnSimulationReset = (callback: VoidFunction, memo: any[]) => {
  const memoCallback = useMemo(() => callback, memo);

  const simId = useSimulatorSelector(selectCurrentSimulationId);
  const activeRunIdRef = useRef(simId);

  useEffect(() => {
    if (simId !== activeRunIdRef.current) {
      activeRunIdRef.current = simId;
      memoCallback();
    }
  }, [simId, memoCallback]);
};

export const useDomElementForFileId = (fileId: string): HTMLElement | null => {
  const [file, setFile] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const file = document.getElementById(getDomIdByFileId(fileId));

    if (file) {
      setFile(file);
    } else {
      console.warn(`file with id ${fileId} does not exist`);
    }
  }, [fileId]);

  return file;
};

export const useSimulationPause = () => {
  const simulatorDispatch = useSimulatorDispatch();
  const simId = useSimulatorSelector(selectCurrentSimulationId);
  const running = useSimulatorSelector(selectRunning);

  useEffect(() => {
    if (running) {
      simulatorDispatch(pauseSimulator({ simId }));
    }
  }, [simulatorDispatch, running, simId]);
};

export const CloseButton: FC = () => {
  const tour = useTour();

  return (
    <button
      aria-label="Exit"
      className="shepherd-cancel-icon"
      type="button"
      onClick={() => tour.cancel()}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
};

const canPlayWebm = (() => {
  const video = document.createElement("video");

  return video.canPlayType(`video/webm; codecs="vp8, vorbis"`) === "probably";
})();

export const Avatar: FC<{
  avatar: string | undefined;
  thumbnail: string | undefined;
}> = ({ thumbnail, avatar }) => {
  if (!avatar && !thumbnail) {
    return null;
  }

  const webm = avatar?.endsWith(".webm");
  const mp4 = avatar?.endsWith(".mp4");

  return mp4 || (webm && canPlayWebm) ? (
    <video src={avatar} autoPlay muted loop playsInline />
  ) : (
    <img src={webm ? thumbnail : avatar || thumbnail} />
  );
};
