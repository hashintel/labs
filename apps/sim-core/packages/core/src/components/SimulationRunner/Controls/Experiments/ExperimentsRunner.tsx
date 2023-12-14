import React, { FC, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useModal } from "react-modal-hook";
import classNames from "classnames";

import { ExperimentModal } from "../../../Modal/Experiments/ExperimentModal";
import { ExperimentsMenu } from "./ExperimentsMenu";
import { IconExperimentsRun } from "../../../Icon/ExperimentsRun";
import { RawExperimentType } from "../../../Modal/Experiments/types";
import { selectCanRunExperiment } from "../../../../features/simulator/simulate/selectors";
import { selectShouldShowExperimentsButton } from "../../../../features/scopes";
import { useSimulatorSelector } from "../../../../features/simulator/context";

import "./ExperimentsRunner.css";

export const ExperimentsRunner: FC = () => {
  const disabled = !useSimulatorSelector(selectCanRunExperiment);
  const shouldShowExperiments = useSelector(selectShouldShowExperimentsButton);
  const ref = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);

  const [currentExperiment, setCurrentExperiment] = useState<
    RawExperimentType | undefined
  >();

  const [openCreateExperimentModal, hideCreateExperimentModal] = useModal(
    () => (
      <ExperimentModal
        onClose={hideCreateExperimentModal}
        experiment={currentExperiment}
      />
    ),
    [currentExperiment],
  );

  if (!shouldShowExperiments) {
    return null;
  }

  return (
    <div
      className={classNames("ExperimentsRunner simulation-control", {
        "simulation-control--open": open,
      })}
      ref={ref}
    >
      <button className="ExperimentsRunnerButton" disabled={disabled}>
        <IconExperimentsRun />
      </button>
      <ExperimentsMenu
        setCurrentExperiment={setCurrentExperiment}
        openModal={openCreateExperimentModal}
        onOpenChange={setOpen}
      />
    </div>
  );
};
