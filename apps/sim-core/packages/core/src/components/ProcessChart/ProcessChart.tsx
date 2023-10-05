import React, { FC, useEffect, useRef, useState } from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";

import { createProcessModelFile, updateFile } from "../../features/files/slice";
import { getItem, setItem } from "../../hooks/useLocalStorage/utils";
import {
  hideActivity,
  setProcessChart,
  showActivity,
} from "../../features/viewer/slice";
import { newProcessChartValue } from "./utils";
import {
  selectActivityVisible,
  selectCurrentProcessChart,
} from "../../features/viewer/selectors";
import { selectCurrentProject } from "../../features/project/selectors";
import { selectProcessModelSourceFiles } from "../../features/files/selectors";
import { trackEvent } from "../../features/analytics";

import "./ProcessChart.scss";

type LocalStorageDrafts = {
  [processName: string]: string;
};

type ProcessChartMessage =
  | {
      type: "setBpmnDraft";
      bpmnDraft: string;
    }
  | {
      type: "commitBpmnFile";
      processName: string;
      contents: string;
    };

const getLocalDrafts = (projectKey: string): LocalStorageDrafts =>
  getItem(`process-charts-${projectKey}`) ?? {};

const setLocalDrafts = (projectKey: string, drafts: LocalStorageDrafts) =>
  setItem(`process-charts-${projectKey}`, drafts);

export const ProcessChart: FC = () => {
  const activityVisible = useSelector(selectActivityVisible);
  const activityWasVisible = useRef(false);

  const chartFiles = useSelector(selectProcessModelSourceFiles, shallowEqual);
  const processChartOption = useSelector(selectCurrentProcessChart);
  const [isDraft, setIsDraft] = useState(true);
  const [saving, setSaving] = useState(false);

  const dispatch = useDispatch();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const project = useSelector(selectCurrentProject);
  const projectRef = useRef<string>(
    `${project?.pathWithNamespace}:${project?.ref}`
  );

  useEffect(() => {
    if (chartFiles[0]) {
      dispatch(setProcessChart(chartFiles[0].path.name));
    }
  }, []);

  const savedChart = chartFiles.find(
    (file) => file.path.name === processChartOption
  );

  // Hide activity on tab load, restore it on unload (if it was visible)
  useEffect(() => {
    if (activityVisible) {
      dispatch(hideActivity());
      activityWasVisible.current = true;
    }
    return () => {
      if (activityWasVisible.current) {
        dispatch(showActivity());
      }
    };
  }, []);

  /**
   * Handle BPMN-specific messages sent by the framed process chart app.
   * The app sends other, more generic messages which are handled in
   * useInstructionReceiver, so other plugins can use them.
   * @todo CiaranMn - bring process chart plugin code into hCore and
   * convert these message handlers to functions passed as props.
   * */

  useEffect(() => {
    const handleMessage = ({ data }: { data: ProcessChartMessage }) => {
      if (data.type === "setBpmnDraft" && !saving) {
        // Update the draft in local storage
        const projectDrafts = getLocalDrafts(projectRef.current);
        projectDrafts[processChartOption] = data.bpmnDraft;
        setLocalDrafts(projectRef.current, projectDrafts);

        // Do we need an 'unsaved draft' indicator?
        if (processChartOption !== newProcessChartValue) {
          setIsDraft(savedChart?.contents !== data.bpmnDraft);
        } else if (!isDraft) {
          setIsDraft(true);
        }
      } else if (data.type === "commitBpmnFile") {
        // Set saving so that draft saving doesn't interfere with clearing 'new'
        setSaving(true);
        if (processChartOption === newProcessChartValue) {
          // The chart is finalised - commit the file so it stays with the project
          const repoPath = `src/processes/${data.processName}.bpmn`;
          dispatch(
            createProcessModelFile({
              contents: data.contents,
              project: project!,
              repoPath,
            })
          );

          // Update the tab to use the new name and clear the 'new' draft
          dispatch(setProcessChart(data.processName));
          const projectDrafts = getLocalDrafts(projectRef.current);
          delete projectDrafts[newProcessChartValue];
          setLocalDrafts(projectRef.current, projectDrafts);

          dispatch(
            trackEvent({
              action: "Add Process Model",
              label: `${project!.type} - ${project!.pathWithNamespace} - ${
                project!.ref
              }`,
              context: {
                processName: data.processName,
              },
            })
          );
        } else if (savedChart) {
          dispatch(
            updateFile({
              id: savedChart.id,
              contents: data.contents,
            })
          );
          dispatch(
            trackEvent({
              action: "Update Process Model",
              label: `${project!.type} - ${project!.pathWithNamespace} - ${
                project!.ref
              }`,
              context: {
                processName: data.processName,
              },
            })
          );
        }
        setSaving(false);
      }
    };
    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [dispatch, isDraft, processChartOption, project, saving, savedChart]);

  const projectUid = `${project?.pathWithNamespace}:${project?.ref}`;

  // Inform the framed window when we have a new project and/or chart selected
  const setProjectRefAndSendChart = () => {
    let existingProcess = false;

    if (projectRef.current !== projectUid) {
      // we've just switched project, default to the first defined chart
      dispatch(
        setProcessChart(chartFiles[0]?.path.name || newProcessChartValue)
      );
      projectRef.current = projectUid;
    } else {
      existingProcess = processChartOption !== newProcessChartValue;
    }

    const localDrafts = getLocalDrafts(projectRef.current);
    const draft = localDrafts[processChartOption];

    // Send the chart names which aren't this one to check for clashes
    const takenProcessNames = [];
    for (const file of chartFiles) {
      if (file.path.name !== processChartOption) {
        takenProcessNames.push(file.path.name);
      }
    }

    frameRef.current?.contentWindow?.postMessage(
      {
        initialBpmn: draft ?? savedChart?.contents,
        /**
         * 'coreHandlingDrafts' is a transitionary measure to let the plugin
         * know not to bother persisting drafts itself.
         * @todo remove this a while after deploying to prod, after we
         * pick up drafts from people who have used the plugin already.
         * */
        coreHandlingDrafts: true,
        takenProcessNames,
        type: "setProject",
        existingProcess,
        value: projectRef.current,
      },
      "*"
    );
  };
  useEffect(setProjectRefAndSendChart, [
    chartFiles,
    dispatch,
    processChartOption,
    projectUid,
    savedChart,
  ]);

  return (
    <div className="ProcessChart">
      <div className="ProcessChart__Header">
        <h3>Process Model Chart</h3>

        <div className="ProcessChart__ChartSelect">
          {isDraft && <span className="ProcessChart__DraftLabel">DRAFT</span>}

          <select
            onChange={(event) => dispatch(setProcessChart(event.target.value))}
            value={processChartOption}
          >
            <option value={newProcessChartValue}>New process</option>
            {chartFiles.map((file) => (
              <option key={file.path.name} value={file.path.name}>
                {file.path.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ProcessChart__Plugin__Wrapper">
        <iframe
          className="ProcessChart__Plugin__Frame"
          ref={frameRef}
          onLoad={setProjectRefAndSendChart}
          src="https://pm.hcore-plugins.hashsandbox.com"
        />
      </div>
    </div>
  );
};
