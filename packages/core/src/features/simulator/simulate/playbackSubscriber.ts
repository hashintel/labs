import { Store } from "@reduxjs/toolkit";

import { SimulatorRootState } from "../types";
import { incrementStep } from "./slice";
import {
  selectPresenting,
  selectPresentingSpeed,
  selectTrackingFinalStep,
} from "./selectors";

export const playbackSubscriber = (store: Store<SimulatorRootState>) => {
  const playback = async (signal: AbortSignal) => {
    /**
     * presentingSpeed can be a float, but we can only increment steps in
     * integer amounts. When presentingSpeed is 1, we want to increase one
     * steps every 16ms. When it is 2, we want to increase two steps every
     * 16ms. But when it is 0.5 (i.e, half speed), we want to increase 1
     * step every 32ms, etc. Additionally, requestAnimationFrame is variable
     * in it's timeout (syncs with the refresh rate of your display),
     * therefore we need to work out how long it has been since we were last
     * called to work out how many steps to increase. Finally, we can only
     * increase a step once enough ticks have elapsed since we last
     * increased a step so that there is at least 1 step ready to tick,
     * so we store the fractional elapsedSteps between each tick
     **/
    let elapsedSteps = 0;
    let prevTime: number | null = null;

    while (!signal.aborted) {
      const timestamp = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );

      if (signal.aborted) {
        break;
      }

      if (prevTime === null) {
        prevTime = timestamp;
      }

      const elapsedTime = timestamp - prevTime;

      prevTime = timestamp;

      const currentState = store.getState();
      const presentingSpeed = selectPresentingSpeed(currentState);

      if (presentingSpeed === "live") {
        throw new Error("Cannot present when live");
      }

      const msPerStep = 1_000 / presentingSpeed;
      const stepsToAdd = elapsedTime / msPerStep;
      const interval = elapsedSteps + stepsToAdd;
      const flooredInterval = Math.floor(interval);

      if (flooredInterval >= 1) {
        store.dispatch(incrementStep(flooredInterval));
      }

      // Checking for equality to deal with Infinity
      elapsedSteps =
        interval === flooredInterval ? 0 : interval - flooredInterval;

      if (signal.aborted) {
        break;
      }
    }
  };

  let controller: AbortController | null = null;
  let shouldPlayback = false;

  return () => {
    const state = store.getState();

    const presenting = selectPresenting(state);
    const presentingSpeed = selectPresentingSpeed(state);
    const tracking = selectTrackingFinalStep(state);

    const nextShouldPlayback =
      presenting &&
      !tracking &&
      presentingSpeed !== "live" &&
      presentingSpeed > 0;

    if (!nextShouldPlayback) {
      controller?.abort();
      controller = null;
    } else if (nextShouldPlayback && !shouldPlayback) {
      controller?.abort();
      controller = new AbortController();

      playback(controller.signal).catch((err) => {
        console.error(err);
      });
    }

    shouldPlayback = nextShouldPlayback;
  };
};
