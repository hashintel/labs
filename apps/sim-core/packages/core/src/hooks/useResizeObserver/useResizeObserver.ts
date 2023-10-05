import { MutableRefObject, useCallback, useEffect, useRef } from "react";
import type { ResizeObserverEntry } from "@juggle/resize-observer";

import type { ResizeObserver } from "./types";

type RefArgType<NodeType extends HTMLElement = HTMLElement> = NodeType | null;

// @todo Provide position
export type UseResizeObserverEntry<NodeType> = {
  width: number;
  height: number;
  target: NodeType;
};

export type UseResizeObserverCallback<NodeType> = (
  entry: UseResizeObserverEntry<NodeType>
) => void;

const toEntry = <NodeType extends HTMLElement>(
  entry: ResizeObserverEntry
): UseResizeObserverEntry<NodeType> => ({
  width: entry.contentRect.width,
  height: entry.contentRect.height,
  target: entry.target as NodeType,
});

const getEntry = <NodeType extends HTMLElement>(
  node: NodeType
): UseResizeObserverEntry<NodeType> => {
  const computedStyle = window.getComputedStyle(node);
  const paddingX =
    parseFloat(computedStyle.paddingLeft || "0px") +
    parseFloat(computedStyle.paddingRight || "0px");
  const paddingY =
    parseFloat(computedStyle.paddingTop || "0px") +
    parseFloat(computedStyle.paddingBottom || "0px");

  return {
    width: node.clientWidth - paddingX,
    height: node.clientHeight - paddingY,
    target: node,
  };
};

/**
 * Wrap a handler such that it can only be called once per frame. This is
 * useful if you have multiple resize observers listening for essentially the
 * same resize event. This is necessary because our useResizeObserver
 * abstraction does not allow observing multiple nodes.
 */
export const useOncePerFrameHandler = <T extends (...args: any[]) => void>(
  handler: T
): T => {
  const timeoutRef = useRef<ReturnType<typeof setImmediate> | null>(null);

  return ((...args: any[]) => {
    if (timeoutRef.current) {
      clearImmediate(timeoutRef.current);
    }

    timeoutRef.current = setImmediate(() => {
      timeoutRef.current = null;
      handler(...args);
    });
  }) as any;
};

const useObserverRef = <NodeType extends HTMLElement = HTMLElement>(
  handlerRef: MutableRefObject<UseResizeObserverCallback<NodeType>>
): MutableRefObject<ResizeObserver> => {
  const observerRef = useRef<ResizeObserver>();

  if (!observerRef.current) {
    observerRef.current = new window.ResizeObserver(([entry]) =>
      handlerRef.current?.(toEntry<NodeType>(entry))
    ) as any;
  }
  return observerRef as any;
};

/**
 * A hook to create a ref to automatically attach a **single** node to a resize
 * observer
 *
 * @warning useResizeObserver provides the current size in a different type to
 *          ResizeObserver. This is because we wanted to provide the current
 *          size at observation time.
 */
export function useResizeObserver<NodeType extends HTMLElement = HTMLElement>(
  handler: UseResizeObserverCallback<NodeType>,
  options?: {
    onObserve?:
      | ((
          newNode: NodeType,
          handler: UseResizeObserverCallback<NodeType>
        ) => void)
      | null;
    onUnobserve?: (
      removedNode: NodeType,
      handler: UseResizeObserverCallback<NodeType>
    ) => void;
  }
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    handlerRef.current = handler;
    optionsRef.current = options;
  });

  const observerRef = useObserverRef<NodeType>(handlerRef);

  const previousNodeRef = useRef<RefArgType<NodeType>>(null);

  const setRef = useCallback(
    (node: RefArgType<NodeType> = null) => {
      if (node === previousNodeRef.current) {
        return;
      }

      const previousNode = previousNodeRef.current;
      previousNodeRef.current = node;

      const observer = observerRef.current!;

      if (previousNode) {
        observer.unobserve(previousNode);
        optionsRef.current?.onUnobserve?.(previousNode, handlerRef.current);
      }

      if (node) {
        observer.observe(node);

        if (document.documentElement.contains(node)) {
          if (optionsRef.current?.onObserve === null) {
            handlerRef.current(getEntry(node));
          } else {
            optionsRef.current?.onObserve?.(node, handlerRef.current);
          }
        }
      }
    },
    [observerRef]
  );

  useEffect(() => {
    return () => {
      setRef(null);
    };
  }, [setRef]);

  return setRef;
}
