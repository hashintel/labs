import { DependencyList, RefObject, useCallback, useRef } from "react";

import { useOnClickOutside } from "../../../../../hooks/useOnClickOutside";

/**
 * @deprecated
 * @see useOnClickOutside
 */
export function useClickOutside<T extends HTMLElement>(
  callback: () => void,
  dependencyList: DependencyList = []
): RefObject<T> {
  const ref = useRef<T>(null);

  const memodCallback = useCallback(callback, dependencyList);

  useOnClickOutside(ref, memodCallback);

  return ref;
}
