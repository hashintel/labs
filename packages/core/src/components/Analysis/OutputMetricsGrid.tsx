import React, { FC, useReducer } from "react";
import { useModal } from "react-modal-hook";
import classNames from "classnames";
import { omit } from "lodash";

import { IconAddDatapoint } from "../Icon/AddDatapoint";
import { IconContentDuplicate } from "../Icon/ContentDuplicate";
import {
  ModalOutputMetrics,
  defaultNewOperation,
} from "../Modal/Analysis/ModalOutputMetrics";
import { Operation, OutputMetricsGridProps } from "./types";
import { getHumanReadableComparison } from "./utils";

import "./OutputMetricsGrid.scss";

const reducer = (state: any, action: any) => {
  switch (action.type) {
    case "CREATE":
      return {
        ...state,
        ...omit(action, "type"),
        isCreate: true,
      };
    case "EDIT":
      return {
        ...state,
        ...omit(action, "type"),
        isCreate: false,
      };
    default:
      throw new Error(
        `OutputMetricsGrid: reducer received an unknown action: "${action.type}"`,
      );
  }
};

export const OutputMetricsGrid: FC<OutputMetricsGridProps> = ({
  metrics,
  readonly,
  onOutputMetricsModalSave,
  onOutputMetricsModalDelete = () => {},
  onDuplicateMetric = () => {},
}) => {
  const [state, modalDispatcher] = useReducer(reducer, {
    currentOperations: [],
    currentMetricKey: "",
    isCreate: false,
    existingMetricKeys: [],
  });

  const [showOutputMetricsModal, hideOutputMetricsModal] = useModal(
    () => (
      <ModalOutputMetrics
        onClose={hideOutputMetricsModal}
        operations={state.currentOperations}
        metricKey={state.currentMetricKey}
        isCreate={state.isCreate}
        onSave={onOutputMetricsModalSave}
        onDelete={onOutputMetricsModalDelete}
        existingMetricKeys={state.existingMetricKeys}
      />
    ),
    [state, onOutputMetricsModalSave, onOutputMetricsModalDelete],
  );

  if (!metrics) {
    return null;
  }
  const metricKeys = Object.keys(metrics);
  if (metricKeys.length === 0) {
    return null;
  }

  const createNewOutputMetric = () => {
    modalDispatcher({
      type: "CREATE",
      currentOperations: [defaultNewOperation],
      currentMetricKey: `MetricName${metricKeys.length + 1}`,
      existingMetricKeys: metricKeys,
    });
    showOutputMetricsModal();
  };

  const editOutputMetric = (ops: Operation[], metricKey: string) => {
    modalDispatcher({
      type: "EDIT",
      currentOperations: ops,
      currentMetricKey: metricKey,
      existingMetricKeys: metricKeys,
    });
    showOutputMetricsModal();
  };

  return (
    <div className="AnalysisViewer__OutputMetricsGridContainer">
      <ul className="AnalysisViewer__OutputMetricsGrid">
        {metricKeys.map((metricKey, key) => (
          <li
            key={metricKey}
            className={classNames(
              "AnalysisViewer__OutputMetricsGrid__ListItem",
              {
                "AnalysisViewer__OutputMetricsGrid__ListItem--readonly":
                  readonly,
              },
            )}
            onClick={(evt) => {
              evt.preventDefault();
              if (!readonly && Array.isArray(metrics[metricKey])) {
                editOutputMetric(metrics[metricKey], metricKey);
              }
            }}
          >
            <span className="AnalysisViewer__OutputMetricsGrid__BigNumber">
              {key}
            </span>
            <div className="AnalysisViewer__OutputMetricsGrid__TextContainer">
              <div className="AnalysisViewer__OutputMetricsGrid__TitleContainer">
                <h3 className="AnalysisViewer__OutputMetricsGrid__Title">
                  {metricKey}
                </h3>
                {readonly || !Array.isArray(metrics[metricKey]) ? null : (
                  <div
                    title="Duplicate"
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      onDuplicateMetric(metricKey);
                    }}
                  >
                    <IconContentDuplicate size={18} />
                  </div>
                )}
              </div>
              {metrics[metricKey].length === 0 ? (
                <span className="AnalysisViewer__OutputMetricsGrid__Operation AnalysisViewer__OutputMetricsGrid__Operation--nooperations">
                  (No operations)
                </span>
              ) : !Array.isArray(metrics[metricKey]) ? (
                <span className="AnalysisViewer__OutputMetricsGrid__Operation AnalysisViewer__OutputMetricsGrid__Operation--nooperations">
                  Error: The operation chain must be an array, but you provided
                  "{typeof metrics[metricKey]}".
                </span>
              ) : (
                metrics[metricKey].map((op, index: number) => (
                  <span
                    className="AnalysisViewer__OutputMetricsGrid__Operation"
                    key={`${op.op}${op.field}${op.comparison}${index}`}
                  >
                    <strong className="AnalysisViewer__OutputMetricsGrid__Operation__Op">
                      {op.op}
                    </strong>
                    {op.field ? (
                      <pre className="AnalysisViewer__OutputMetricsGrid__Operation__Field">
                        {op.field}
                      </pre>
                    ) : null}{" "}
                    {op.comparison ? (
                      <span className="AnalysisViewer__OutputMetricsGrid__Operation__Comparison">
                        {getHumanReadableComparison(op.comparison)}
                      </span>
                    ) : null}{" "}
                    {op.value || op.value === 0 || op.value === false ? (
                      <pre className="AnalysisViewer__OutputMetricsGrid__Operation__Value">
                        {JSON.stringify(op.value)}
                      </pre>
                    ) : null}
                  </span>
                ))
              )}
            </div>
          </li>
        ))}
        {readonly ? null : (
          <li
            key="addNewMetric"
            className="AnalysisViewer__OutputMetricsGrid__ListItem AnalysisViewer__OutputMetricsGrid__ListItem__AddNewMetric"
            onClick={createNewOutputMetric}
          >
            <div className="AnalysisViewer__OutputMetricsGrid__ListItem__AddNewMetric">
              <span className="AnalysisViewer__OutputMetricsGrid__BigNumber">
                <IconAddDatapoint size={48} />
              </span>
              <div className="AnalysisViewer__OutputMetricsGrid__TextContainer">
                <h3 className="AnalysisViewer__OutputMetricsGrid__Title">
                  Add new metric
                </h3>
              </div>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
};
