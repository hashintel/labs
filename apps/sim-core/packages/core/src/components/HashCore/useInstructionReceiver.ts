import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { maxBy } from "lodash";

import { AnalysisObject, Plot } from "../Analysis/types";
import { HcFile } from "../../features/files/types";
import {
  addDependencies,
  createBehavior,
  updateFile,
} from "../../features/files/slice";
import { parse } from "../../util/files";
import { pauseAndNew } from "../../features/simulator/simulate/thunks";
import { selectAllFiles } from "../../features/files/selectors";
import { selectCurrentProject } from "../../features/project/selectors";
import { selectCurrentSimulationData } from "../../features/simulator/simulate/selectors";
import { toggleCurrentSimulator } from "../../features/simulator/simulate/slice";
import {
  useSimulatorDispatch,
  useSimulatorStore,
} from "../../features/simulator/context";

interface InstructionUpdateFile {
  contents: string;
  file: string;
  id: string;
  type: "updateFile";
}

interface InstructionUpsertCreatorAgent {
  contents: string;
  file: string;
  id: string;
  type: "upsertCreatorAgent";
}

interface InstructionAddDependencies {
  contents: Record<string, string>;
  id: string;
  type: "addDependencies";
}

interface InstructionIntialize {
  id: string;
  type: "initialize";
}

interface InstructionResetAndRun {
  id: string;
  type: "resetAndRun";
}

interface InstructionSendState {
  id: string;
  type: "sendState";
}

interface InstructionUpdateAnalysis {
  contents: AnalysisObject;
  id: string;
  type: "updateAnalysis";
}

type InstructionData =
  | InstructionAddDependencies
  | InstructionIntialize
  | InstructionResetAndRun
  | InstructionSendState
  | InstructionUpdateAnalysis
  | InstructionUpdateFile
  | InstructionUpsertCreatorAgent;

const isPluginMessage = (
  event: MessageEvent,
): event is MessageEvent<InstructionData> =>
  [
    "addDependencies",
    "initialize",
    "resetAndRun",
    "sendState",
    "updateAnalysis",
    "updateFile",
    "upsertCreatorAgent",
  ].includes(event.data.type);

/**
 * Receives instructions from plugins which are either
 *  (a) embedded in hCore (e.g. the Process Chart), or
 *  (b) embedding hCore.
 */
export const useInstructionReceiver = () => {
  const dispatch = useDispatch();
  const files = useSelector(selectAllFiles);
  const handledMessages = useRef<string[]>([]);
  const project = useSelector(selectCurrentProject);

  const simulatorDispatch = useSimulatorDispatch();

  const shouldSendFiles = useRef(false);
  const simStore = useSimulatorStore();

  const sendFiles = useMemo(
    () => (files: HcFile[]) =>
      parent.window.postMessage(
        {
          type: "files",
          contents: files,
        },
        "*",
      ),
    [],
  );
  useEffect(() => {
    // If it has been requested from a plugin via an 'initialize' call,
    // send files data every time files change.
    if (shouldSendFiles.current) {
      sendFiles(files);
    }
  }, [files, sendFiles]);

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      if (!isPluginMessage(event)) {
        return;
      }

      // postMessage seems to overfire in some circumstances
      if (handledMessages.current.includes(event.data.id)) {
        return;
      }
      handledMessages.current.push(event.data.id);

      switch (event.data.type) {
        case "addDependencies":
          dispatch(addDependencies(event.data.contents));
          return;

        case "resetAndRun":
          await simulatorDispatch(pauseAndNew());
          simulatorDispatch(toggleCurrentSimulator());
          return;

        case "updateFile":
          const { file, contents } = event.data;
          const foundFile = Object.values(files)?.find(
            (fileOption) => fileOption?.path.formatted === file,
          );
          if (foundFile) {
            dispatch(updateFile({ id: foundFile.id, contents }));
          } else {
            console.error(`Could not find file at path ${file} to update`);
          }
          return;

        case "upsertCreatorAgent": {
          const { file, contents } = event.data;
          const foundFile = Object.values(files)?.find(
            (fileOption) => fileOption?.path.formatted === file,
          );
          if (foundFile) {
            dispatch(updateFile({ id: foundFile.id, contents }));
          } else {
            dispatch(
              createBehavior({
                contents,
                path: parse(file),
                project: project!,
              }),
            );
            const initJson = Object.values(files)?.find(
              (file) => file.path.base === "init.json",
            );
            try {
              const initParsed = JSON.parse(initJson!.contents);
              initParsed.push({
                behaviors: [file],
              });
              dispatch(
                updateFile({
                  id: initJson!.id,
                  contents: JSON.stringify(initParsed, null, 2),
                }),
              );
            } catch (err) {
              console.error("init.json is not valid JSON - could not update.");
            }
          }
          return;
        }

        // Add supplied outputs and plots to analysis.json
        // Replace if we can find a match for the name / key
        case "updateAnalysis":
          const analysisJson = Object.values(files)?.find(
            (file) => file.path.base === "analysis.json",
          );

          try {
            const stringToNumber = (number: string | number) =>
              typeof number === "number"
                ? number
                : parseFloat(number.replace(/[^0-9.]/g, ""));
            const analysisParsed = JSON.parse(analysisJson!.contents);
            analysisParsed.outputs ??= {};
            analysisParsed.plots ??= [];
            const { outputs, plots } = analysisParsed;

            analysisParsed.plots = plots.filter(
              (existingPlot: any) =>
                !(event.data as InstructionUpdateAnalysis).contents.plots.find(
                  (plot) => plot.title === existingPlot?.title,
                ),
            );

            const lowestPlot = maxBy(analysisParsed.plots, (plot: Plot) =>
              stringToNumber(plot.position.y),
            );
            let nextPosition =
              stringToNumber(lowestPlot?.position?.y ?? 0) +
              stringToNumber(lowestPlot?.layout.height ?? 0);
            for (const newPlot of event.data.contents.plots) {
              newPlot.layout = { width: "100%", height: "50%" };
              newPlot.position = { x: "0", y: `${nextPosition}%` };
              nextPosition = nextPosition + 50;
              analysisParsed.plots.push(newPlot);
            }

            for (const [title, data] of Object.entries(
              event.data.contents.outputs,
            )) {
              outputs[title] = data;
            }
            dispatch(
              updateFile({
                id: analysisJson!.id,
                contents: JSON.stringify(analysisParsed, null, 2),
              }),
            );
          } catch (err) {
            console.error(
              "analysis.json is not valid JSON - could not update.",
            );
          }
          return;

        // A message to indicate that a plugin is embedding hCore,
        // so that we don't attempt to communicate with one otherwise.
        case "initialize":
          shouldSendFiles.current = true;
          window.parent.postMessage(
            {
              type: "initialized",
            },
            "*",
          );
          sendFiles(files);
          return;

        case "sendState":
          window.parent.postMessage(
            {
              type: "state",
              contents: selectCurrentSimulationData(simStore.getState()),
            },
            "*",
          );
          return;
      }
    },
    [dispatch, files, project, sendFiles, simStore],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);
};
