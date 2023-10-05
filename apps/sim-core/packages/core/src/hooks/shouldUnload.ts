import { useEffect, useRef } from "react";

export const useShouldUnload = (shouldUnload: boolean) => {
  const shouldUnloadRef = useRef(shouldUnload);

  useEffect(() => {
    shouldUnloadRef.current = shouldUnload;
  });

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldUnloadRef.current) {
        event.preventDefault();
        event.returnValue = "";
        return event.returnValue;
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
};
