import React, { useState } from "react";
import { createPortal } from "react-dom";

import { useResizeObserver } from "../useResizeObserver/useResizeObserver";

export const useRemSize = () => {
  const [remSize, setRemSize] = useState(0);

  const setObserver = useResizeObserver(() => {
    setRemSize(
      parseFloat(window.getComputedStyle(document.documentElement).fontSize)
    );
  });

  const portal = createPortal(
    <div
      ref={setObserver}
      style={{
        fontSize: "1rem",
        position: "absolute",
        top: 0,
        left: 0,
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      rem
    </div>,
    document.body
  );

  return [remSize, portal];
};
