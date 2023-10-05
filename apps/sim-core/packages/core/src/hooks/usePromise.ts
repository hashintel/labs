import { useState, useEffect, useRef } from "react";

export function usePromise<T>(
  getPromise: () => Promise<T>,
  shouldFetch: boolean = true
) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState(null);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    hasFetchedRef.current = false;
  }, [getPromise]);

  useEffect(() => {
    if (!shouldFetch || hasFetchedRef.current) {
      return;
    }

    hasFetchedRef.current = true;
    let didCancel = false;

    getPromise()
      .then((value) => {
        if (!didCancel) {
          setValue(() => value);
        }
      })
      .then(null, (error: any) => {
        if (!didCancel) {
          setError(() => error);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [setValue, setError, getPromise, shouldFetch]);

  if (error) {
    throw error;
  }

  return shouldFetch ? value : null;
}
