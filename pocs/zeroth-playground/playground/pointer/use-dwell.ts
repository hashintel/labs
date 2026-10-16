import { useRef, useState } from "react";

import { DWELL_MS, NO_MOTION, restLeft, sampleMotion } from "./pointer-motion";

// One listener for the page follows the pointer's speed for every dwell.
let motion = NO_MOTION;

function trackMotion(event: PointerEvent) {
  motion = sampleMotion(motion, { x: event.clientX, y: event.clientY, t: event.timeStamp });
}

const LISTENING = { capture: true, passive: true } as const;
window.addEventListener("pointermove", trackMotion, LISTENING);
import.meta.hot?.dispose(() => window.removeEventListener("pointermove", trackMotion, LISTENING));

/**
 * A hovered value that only takes effect once the pointer settles on it:
 * `pointAt` reports what the pointer is on, and the returned value follows
 * once `DWELL_MS` have passed since then and since the pointer last moved
 * faster than resting. A pointer sweeping across lines, nodes or stages
 * never settles on any of them, and the last value it settled on holds
 * until it does. The timer lives in the handler that starts it.
 */
export function useDwell<T>(initial: T): [settled: T, pointAt: (value: T) => void] {
  const [settled, setSettled] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  function pointAt(value: T) {
    window.clearTimeout(timer.current);
    function settle() {
      const left = restLeft(motion, performance.now(), DWELL_MS);
      if (left > 0) {
        timer.current = window.setTimeout(settle, left);
      } else {
        setSettled(value);
      }
    }
    timer.current = window.setTimeout(settle, DWELL_MS);
  }

  return [settled, pointAt];
}
