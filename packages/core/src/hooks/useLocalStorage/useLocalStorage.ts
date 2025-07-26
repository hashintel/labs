import { useState, useEffect, Dispatch, SetStateAction } from "react";

import { getItem, setItem } from "./utils";

/**
 * wraps `useState` so that a `useEffect` also stores changes in `localStorage`
 * handles serializing and deserializing to a string
 *
 * @export
 * @template T -
 * @param {string} key
 * @param {*} initialValue
 * @returns {[T, Dispatch<SetStateAction<T>>]}
 *
 * TODO: @mysterycommand - it'd be great if the signature could be:
 * ```ts
 * useLocalStorage<T extends Json>(
 *   key: string,
 *   initialValue: T
 * ): [T, Dispatch<SetStateAction<T>>]
 * ```
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: any,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => (getItem(key) ?? initialValue) as T);

  useEffect(() => {
    const savedValue = getItem(key);
    if (savedValue) {
      setValue(savedValue);
    } else {
      setItem(key, value);
    }
  }, [key]);

  useEffect(() => {
    setItem(key, value);
  }, [value]);

  return [value, setValue];
}
