import React, { FC, useCallback, useRef } from "react";

import { ExperimentsRunner } from "./Controls/Experiments/ExperimentsRunner";
import { PlayPause } from "./Controls/PlayPause/PlayPause";
import { Reset } from "./Controls/Reset";
import { StepButton } from "./Controls/StepButton";
import { Timeline } from "./Controls/Timeline";
import {
  pauseAndNew,
  stepSimulator,
} from "../../features/simulator/simulate/thunks";
import { toggleCurrentSimulator } from "../../features/simulator/simulate/slice";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";
import { useSimulatorDispatch } from "../../features/simulator/context";

import "./SimulationRunner.css";

export const SimulationRunner: FC = () => {
  const dispatch = useSimulatorDispatch();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useKeyboardShortcuts({
    meta: {
      Enter() {
        dispatch(toggleCurrentSimulator());
      },
    },
    alt: {
      Enter() {
        dispatch(pauseAndNew());
      },
    },
    metaShift: {
      Enter() {
        dispatch(stepSimulator());
      },
    },
  });

  const attachResizeObserver = useResizeObserver(
    () => {
      if (containerRef.current) {
        // @todo use refs for all of these
        const reset =
          containerRef.current.querySelector<HTMLDivElement>(
            ".reset.simulation-control",
          )?.offsetLeft ?? 0;
        const experiments =
          containerRef.current.querySelector<HTMLDivElement>(
            ".ExperimentsRunner",
          )?.offsetLeft ?? 0;
        const step =
          containerRef.current.querySelector<HTMLDivElement>(
            ".step.simulation-control",
          )?.offsetLeft ?? 0;
        const simulate =
          containerRef.current.querySelector<HTMLDivElement>(
            ".simulate.simulation-control",
          )?.offsetLeft ?? 0;
        for (const [key, value] of Object.entries({
          reset,
          experiments,
          step,
          simulate,
        })) {
          const prop = `--runner-tooltip-left-offset-${key}`;
          if (value !== null) {
            document.documentElement.style.setProperty(prop, `${value}px`);
          } else {
            document.documentElement.style.removeProperty(value);
          }
        }
      }
    },
    {
      onObserve: null,
    },
  );

  const setRef = useCallback(
    (node: HTMLDivElement | null = null) => {
      containerRef.current = node;

      attachResizeObserver(node);
    },
    [attachResizeObserver],
  );

  return (
    <div
      className="simulation-control-container simulation-runner"
      ref={setRef}
    >
      <Reset />
      <ExperimentsRunner />
      <StepButton />
      <PlayPause />
      <Timeline />
    </div>
  );
};
