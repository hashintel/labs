import React, { Dispatch, FC, ReactNode, SetStateAction } from "react";
import { useDispatch, useSelector } from "react-redux";

import { AppDispatch } from "../../../../features/types";
import { ExperimentsListError } from "./ExperimentsListError";
import { IconPencil } from "../../../Icon/Pencil/IconPencil";
import { IconRunFast } from "../../../Icon/RunFast";
import { RawExperimentType } from "../../../Modal/Experiments/types";
import { Scrollable } from "../../../Scrollable";
import { SimpleTooltip } from "../../../SimpleTooltip";
import { experimentsFileId } from "../../../../features/files/utils";
import { queueExperiment } from "../../../../features/simulator/simulate/queueExperiment";
import { selectExperiments } from "./selectors";
import { selectProviderTarget } from "../../../../features/simulator/simulate/selectors";
import { setCurrentFileId } from "../../../../features/files/slice";
import { trackEvent } from "../../../../features/analytics";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../features/simulator/context";

import "./ExperimentsList.scss";

export const DisabledExperimentTooltip: FC = () => (
  <SimpleTooltip
    allRoundedBorders
    className="DisabledExperimentTooltip"
    inModal
    position="below"
  >
    Enable Cloud to run optimization experiments.
  </SimpleTooltip>
);

export const ExperimentsList: FC<{
  onClose: VoidFunction;
  openModal: VoidFunction;
  setCurrentExperiment: Dispatch<SetStateAction<RawExperimentType | undefined>>;
}> = ({ onClose, openModal, setCurrentExperiment }) => {
  const dispatch = useDispatch<AppDispatch>();
  const simulatorDispatch = useSimulatorDispatch();
  const entries = useSelector(selectExperiments);
  const target = useSimulatorSelector(selectProviderTarget);

  if (!entries) {
    return <ExperimentsListError />;
  }

  if (!entries.length) {
    return null;
  }

  return (
    <Scrollable className="ExperimentsListScrollable">
      {({ itemClassName }) => (
        <ul className="ExperimentsList">
          {entries.map<ReactNode>(([name, { description, type, ...other }]) => {
            const disabledOptimizationExperiment =
              target !== "cloud" && type === "optimization";
            return (
              <li key={name}>
                {disabledOptimizationExperiment ? (
                  <DisabledExperimentTooltip />
                ) : null}
                <button
                  className={`ExperimentsMenu__Button ExperimentsMenu__Button--experiment ${itemClassName}`}
                  disabled={disabledOptimizationExperiment}
                  onClick={(evt) => {
                    evt.preventDefault();
                    onClose();
                    simulatorDispatch(queueExperiment(name));
                  }}
                >
                  <div className="ExperimentsMenu__Button--experiment__Label">
                    <span>{name}</span>
                    <span className="ExperimentsMenu__Button--experiment__Label__Description">
                      {description ?? <em>No description</em>}
                    </span>
                  </div>
                  <span
                    className="ExperimentsMenu__ButtonEditExperiment"
                    onClick={(evt) => {
                      evt.preventDefault();
                      evt.stopPropagation();
                      dispatch(setCurrentFileId(experimentsFileId));
                      const dynamicFields: any = {};
                      dynamicFields[type] = other;
                      const newExperiment: RawExperimentType = {
                        experimentTitle: name,
                        experimentType: type,
                        dynamicFields,
                      };
                      setCurrentExperiment(newExperiment);
                      openModal();
                      trackEvent({
                        action: "Experiment wizard opened",
                        label: "ExperimentsList",
                      });
                    }}
                  >
                    <IconPencil />
                  </span>
                  <IconRunFast />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Scrollable>
  );
};
