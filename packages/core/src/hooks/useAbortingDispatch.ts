import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";

import { AppDispatch } from "../features/types";

export const useAbortingDispatch = <T extends (...args: any) => any>(
  actionCreator: T,
  deps: any[] = [],
  disableWhilstRunning = true,
) => {
  const dispatch = useDispatch<AppDispatch>();
  const abortPromiseRef = useRef<{ abort: VoidFunction } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setRunning(false);

    return () => {
      abortPromiseRef.current?.abort();
      abortPromiseRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const abortingDispatch: (...args: Parameters<T>) => Promise<void> =
    useCallback(
      async (...args: any[]) => {
        if (!(disableWhilstRunning && abortPromiseRef.current)) {
          abortPromiseRef.current?.abort();
          abortPromiseRef.current = dispatch(actionCreator(...args));
          setRunning(true);
          await abortPromiseRef.current;
          setRunning(false);
          abortPromiseRef.current = null;
        }
      },
      [disableWhilstRunning, dispatch, actionCreator],
    );
  return [abortingDispatch, running] as const;
};
