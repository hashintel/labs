import React, { Dispatch, FC, SetStateAction } from "react";

import { ExperimentsList } from "./ExperimentsList";
import { IconExperimentsCreate } from "../../../Icon/ExperimentsCreate";
import { RawExperimentType } from "../../../Modal/Experiments/types";
import { Scope, useScope } from "../../../../features/scopes";
import { SimpleTooltip } from "../../../SimpleTooltip";
import { useFiles } from "../../../../features/files/FilesContext";
import { useCloseTooltip } from "../../../SimpleTooltip/context";

import "./ExperimentsMenu.css";

type ExperimentsMenuProps = {
  openModal: VoidFunction;
  setCurrentExperiment: Dispatch<SetStateAction<RawExperimentType | undefined>>;
};

const ExperimentsMenuList: FC<ExperimentsMenuProps> = ({
  openModal,
  setCurrentExperiment,
}) => {
  const { setCurrentFileId } = useFiles();
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
              setCurrentFileId("experiments");
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
