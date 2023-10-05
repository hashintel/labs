import { useCallback, useEffect, useRef } from "react";

/**
 * This allows you to debounce a function call in a way that can be cancelled if
 * any deps change or if the relevant component unmounts – this allows you to
 * prevent updating an unmounted component.
 */
export const useCancellableDebounce = (cancelDeps: any[] = []) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, cancelDeps);

  return useCallback((handler: VoidFunction, ms: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      handler();
    }, ms);
  }, []);
};
