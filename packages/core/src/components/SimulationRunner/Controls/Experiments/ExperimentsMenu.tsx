import React, { Dispatch, FC, SetStateAction } from "react";
import { useDispatch } from "react-redux";

import { AppDispatch } from "../../../../features/types";
import { ExperimentsList } from "./ExperimentsList";
import { IconExperimentsCreate } from "../../../Icon/ExperimentsCreate";
import { RawExperimentType } from "../../../Modal/Experiments/types";
import { Scope, useScope } from "../../../../features/scopes";
import { SimpleTooltip } from "../../../SimpleTooltip";
import { setCurrentFileId } from "../../../../features/files/slice";
import { useCloseTooltip } from "../../../SimpleTooltip/context";

import "./ExperimentsMenu.css";

interface ExperimentsMenuProps {
  openModal: VoidFunction;
  setCurrentExperiment: Dispatch<SetStateAction<RawExperimentType | undefined>>;
}

const ExperimentsMenuList: FC<ExperimentsMenuProps> = ({
  openModal,
  setCurrentExperiment,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const closeTooltip = useCloseTooltip();
  const canEdit = useScope(Scope.edit);

  return (
    <ul className="ExperimentsMenu__List">
      <ExperimentsList
        onClose={closeTooltip}
        openModal={openModal}
        setCurrentExperiment={setCurrentExperiment}
      />
      {canEdit ? (
        <li className="ExperimentsMenu__List__Create">
          <button
            onClick={(evt) => {
              evt.preventDefault();
              dispatch(setCurrentFileId("experiments"));
              setCurrentExperiment(undefined);
              openModal();
              closeTooltip();
            }}
            className="ExperimentsMenu__Button ExperimentsMenu__Button--special"
          >
            <IconExperimentsCreate /> <span>Create new experiment</span>
          </button>
        </li>
      ) : null}
    </ul>
  );
};

export const ExperimentsMenu: FC<
  ExperimentsMenuProps & {
    onOpenChange?: (open: boolean) => void;
  }
> = ({ onOpenChange, ...props }) => (
  <SimpleTooltip
    interactive
    persistent
    position="above"
    className="ExperimentsMenu"
    onOpenChange={onOpenChange}
  >
    <ExperimentsMenuList {...props} />
  </SimpleTooltip>
);
