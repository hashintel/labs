import { useLayoutEffect, useState } from "react";

const canHoverMql = window?.matchMedia?.("(any-hover: hover)");

type Listener = (evt: MediaQueryListEvent) => void;

/**
 * This is necessary as Safari 13 does not support addEventListener on
 * MediaQueryList's. Cannot just use addListener as browsers may remove it.
 */
const addMqlListener = canHoverMql
  ? "addEventListener" in (canHoverMql as any)
    ? (listener: Listener) => {
        canHoverMql.addEventListener("change", listener);

        return () => {
          canHoverMql.removeEventListener("change", listener);
        };
      }
    : (listener: Listener) => {
        canHoverMql.addListener(listener);

        return () => {
          canHoverMql.removeListener(listener);
        };
      }
  : (_: Listener) => () => {};

/**
 * @todo consider putting this in context instead
 */
export const useCanHover = () => {
  const [result, setResult] = useState(canHoverMql?.matches ?? true);

  useLayoutEffect(() => {
    const remove = addMqlListener((evt) => {
      setResult(evt.matches);
    });

    return () => {
      remove();
    };
  }, []);

  return result;
};
