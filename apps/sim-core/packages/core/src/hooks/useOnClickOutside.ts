import { RefObject, useEffect, useRef } from "react";

type ClickOutsideEvent = MouseEvent | TouchEvent;

/**
 * Based on https://usehooks.com/useOnClickOutside/
 */
export const useOnClickOutside = <T extends HTMLElement>(
  ref: RefObject<T>,
  handler: (event: ClickOutsideEvent) => void,
) => {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (event: ClickOutsideEvent) => {
      if (!ref.current || ref.current.contains(event.target as HTMLElement)) {
        return;
      }

      handlerRef.current(event);
    };

    document.addEventListener("click", listener, { passive: true });
    document.addEventListener("contextmenu", listener, { passive: true });

    return () => {
      document.removeEventListener("click", listener);
      document.removeEventListener("contextmenu", listener);
    };
  }, [ref]);
};
