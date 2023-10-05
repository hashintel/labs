import { useEffect, useState } from "react";
import { SimulationStates } from "@hashintel/engine-web";

import { SimulationData } from "../../../features/simulator/simulate/types";
import { simulationViewable } from "../../../features/simulator/simulate/util";
import { yieldToBrowser } from "../../../util/yieldToBrowser";

// @see https://stackoverflow.com/a/14919494
const humanFileSize = (bytes: number, si = false, decimalPlaces = 1) => {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si
    ? ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let unitIndex = -1;
  const base = 10 ** decimalPlaces;

  do {
    bytes /= thresh;
    ++unitIndex;
  } while (
    Math.round(Math.abs(bytes) * base) / base >= thresh &&
    unitIndex < units.length - 1
  );

  return bytes.toFixed(decimalPlaces) + " " + units[unitIndex];
};

const buildJsonString = async (
  steps: SimulationStates,
  stepCount: number,
  signal?: AbortSignal
) => {
  let str = "";

  for (let idx = 0; idx < stepCount; idx++) {
    const step = steps[idx];
    str += JSON.stringify(step) + "\n";
    await yieldToBrowser();
    if (signal?.aborted) {
      return;
    }
  }

  return str;
};

const byteCount = (string: string) => new TextEncoder().encode(string).length;

const stepsMap = new WeakMap<SimulationStates, string>();

const defaultSize = "...";

let fileSizePromise = Promise.resolve();

const defaultSteps = {};

export const useFileSize = (
  experimentFinished: boolean,
  run: SimulationData | null | undefined
) => {
  const steps = run?.steps ?? defaultSteps;
  const stepCount = run?.stepsCount ?? 0;
  const viewable = simulationViewable(run);
  const canCalculateSize = experimentFinished && viewable && stepCount > 0;
  const currentDefaultSize =
    run?.status === "errored" && !viewable ? "N/A" : defaultSize;

  const [size, setSize] = useState<string>(
    (canCalculateSize ? stepsMap.get(steps) : null) ?? currentDefaultSize
  );

  useEffect(() => {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      fileSizePromise = fileSizePromise
        .then(async () => {
          if (controller.signal.aborted) {
            return;
          }

          if (canCalculateSize) {
            const cached = stepsMap.get(steps);

            if (cached) {
              setSize(cached);
            } else {
              const str = await buildJsonString(
                steps,
                stepCount,
                controller.signal
              );

              if (typeof str !== "string") {
                return;
              }

              const count = byteCount(str);
              await yieldToBrowser();
              if (controller.signal.aborted) {
                return;
              }

              const size = humanFileSize(count, true);
              stepsMap.set(steps, size);

              setSize(size);
            }
          } else {
            setSize(currentDefaultSize);
          }
        })
        .catch((err) => {
          console.error("Unable to calculate file size", err);
        });
    }, 1_000);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [canCalculateSize, currentDefaultSize, stepCount, steps]);

  if (stepCount === 0) {
    return "";
  }

  return size;
};
