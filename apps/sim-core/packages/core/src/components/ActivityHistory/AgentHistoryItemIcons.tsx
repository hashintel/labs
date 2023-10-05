import React, { FC } from "react";
import classNames from "classnames";

import { IconClose } from "../Icon/Close";
import { IconDownload } from "../Icon/Download";
import { removeExperiment } from "../../features/simulator/simulate/slice";
import { removeSimulationRun } from "../../features/simulator/simulate/thunks";
import { useSimulatorDispatch } from "../../features/simulator/context";

import "./AgentHistoryItemIcons.scss";

export const AgentHistoryItemIcons: FC<{
  id: string;
  exporting?: boolean;
  experimentGroup?: boolean;
  canDelete?: boolean;
}> = ({ id, exporting = false, experimentGroup = false, canDelete = true }) => {
  const dispatch = useSimulatorDispatch();
  const showDeleteIcon = canDelete && !exporting;

  return exporting || showDeleteIcon ? (
    <button
      className={classNames("AgentHistoryItemIcons", {
        "AgentHistoryItemIcons--exporting": exporting,
      })}
      onClick={(evt) => {
        evt.stopPropagation();
        if (showDeleteIcon) {
          if (experimentGroup) {
            dispatch(removeExperiment(id));
          } else {
            dispatch(removeSimulationRun(id));
          }
        }
      }}
    >
      {exporting ? (
        <IconDownload size={18} />
      ) : showDeleteIcon ? (
        <IconClose size={8} />
      ) : null}
    </button>
  ) : null;
};
