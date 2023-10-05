import React, {
  createContext,
  FC,
  HTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";

type Unsubscribe = VoidFunction;
type Subscribe = (handler: VoidFunction) => Unsubscribe;

const KeepInViewContext = createContext<Subscribe | null>(null);

export const KeepInViewProvider: FC<HTMLAttributes<HTMLDivElement>> = ({
  children,
  ...props
}) => {
  const subscribersRef = useRef([] as VoidFunction[]);
  const observerRef = useResizeObserver(() => {
    for (const handler of subscribersRef.current) {
      handler();
    }
  });

  const subscribe = useCallback<Subscribe>((handler) => {
    subscribersRef.current.push(handler);

    return () => {
      subscribersRef.current.splice(subscribersRef.current.indexOf(handler), 1);
    };
  }, []);

  return (
    <KeepInViewContext.Provider value={subscribe}>
      <div {...props} ref={observerRef}>
        {children}
      </div>
    </KeepInViewContext.Provider>
  );
};

export const useKeepInView = () => {
  const parentRef = useRef<HTMLElement | null>(null);
  const childRef = useRef<HTMLElement | null>(null);
  const subscribe = useContext(KeepInViewContext);

  if (!subscribe) {
    throw new Error("Cannot call useKeepInView outside of KeepInViewProvider");
  }

  const scroll = useCallback(() => {
    if (childRef.current && parentRef.current) {
      parentRef.current.scrollTo(
        childRef.current.offsetLeft - parentRef.current.offsetLeft,
        childRef.current.offsetTop - parentRef.current.offsetTop
      );
    }
  }, []);

  useEffect(() => {
    scroll();
  });

  useEffect(() => {
    const unsubscribe = subscribe(scroll);

    return () => {
      unsubscribe();
    };
  }, [subscribe, scroll]);

  const setParentRef = useCallback(
    (node: HTMLElement | null) => {
      if (node === parentRef.current) {
        return;
      }

      parentRef.current = node;
      scroll();
    },
    [scroll]
  );

  const setChildRef = useCallback(
    (node: HTMLElement | null) => {
      if (node === childRef.current) {
        return;
      }

      childRef.current = node;
      scroll();
    },
    [scroll]
  );

  return [setParentRef, setChildRef];
};
