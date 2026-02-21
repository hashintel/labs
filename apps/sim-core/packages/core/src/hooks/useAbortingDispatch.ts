import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A hook that wraps an async operation with abort/cancellation support.
 * When re-invoked before the previous call finishes, it optionally
 * prevents the new call (disableWhilstRunning).
 *
 * @deprecated Prefer calling context methods directly.
 */
export const useAbortingDispatch = <T extends (...args: any[]) => Promise<any>>(
  asyncFn: T,
  deps: any[] = [],
  disableWhilstRunning = true,
) => {
  const controllerRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRunning(false);

    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const abortingDispatch: (...args: Parameters<T>) => Promise<void> =
    useCallback(
      async (...args: any[]) => {
        if (!(disableWhilstRunning && controllerRef.current)) {
          controllerRef.current?.abort();
          controllerRef.current = new AbortController();
          setRunning(true);
          try {
            await asyncFn(...args);
          } finally {
            setRunning(false);
            controllerRef.current = null;
          }
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [disableWhilstRunning, asyncFn],
    );
  return [abortingDispatch, running] as const;
};
