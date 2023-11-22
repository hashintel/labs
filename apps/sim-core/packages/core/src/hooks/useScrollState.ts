import { useCallback, useEffect, useRef, useState } from "react";

import { useResizeObserver } from "./useResizeObserver/useResizeObserver";

type Mode = "horizontal" | "vertical";

const calculate = (mode: Mode, node: HTMLElement) => {
  const {
    scrollHeight,
    scrollTop,
    offsetHeight,
    scrollWidth,
    scrollLeft,
    offsetWidth,
  } = node;

  switch (mode) {
    case "vertical":
      return {
        contentRemaining: offsetHeight + scrollTop < scrollHeight,
        scrollable: offsetHeight < scrollHeight,
      };
    case "horizontal":
      return {
        contentRemaining: offsetWidth + scrollLeft < scrollWidth,
        scrollable: offsetWidth < scrollWidth,
      };
  }
};

export const useScrollState = (mode: Mode = "vertical") => {
  const ref = useRef<HTMLElement | null>(null);
  const [current, set] = useState({
    scrollable: false,
    contentRemaining: false,
  });

  const currentRef = useRef(current);

  useEffect(() => {
    currentRef.current = current;
  });

  const { scrollable, contentRemaining } = current;

  const handler = useCallback(() => {
    if (!ref.current) {
      return;
    }

    const next = calculate(mode, ref.current);
    const current = currentRef.current;

    if (
      next.scrollable !== current.scrollable ||
      next.contentRemaining !== current.contentRemaining
    ) {
      set(next);
    }
  }, [mode]);

  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  const setResizeObserverRef = useResizeObserver<HTMLElement>(handler, {
    onObserve: null,
  });

  const mutationObserver = useRef<MutationObserver>();

  if (!mutationObserver.current) {
    mutationObserver.current = new MutationObserver(() => {
      handlerRef.current();
    });
  }

  const setRef = useCallback(
    (newRef?: HTMLElement | null) => {
      if (ref.current) {
        ref.current.removeEventListener("scroll", handler);
      }

      ref.current = newRef ?? null;
      setResizeObserverRef(newRef);

      if (newRef) {
        mutationObserver.current!.observe(newRef, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      } else {
        mutationObserver.current!.disconnect();
      }

      if (newRef) {
        newRef.addEventListener("scroll", handler);
      }
    },
    [handler, setResizeObserverRef],
  );

  return [setRef, contentRemaining, scrollable] as const;
};
