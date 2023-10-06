import React, {
  FC,
  MouseEventHandler,
  ReactElement,
  ReactFragment,
} from "react";
import classNames from "classnames";

import { AnalysisViewerActionButtonsProps } from "./types";
import { IconAddDatapoint } from "../Icon/AddDatapoint";
import { IconCreatePlot } from "../Icon/CreatePlot";
import { SimpleTooltip } from "../SimpleTooltip";

import "./TabListActionButtons.scss";

type ListItemProps = {
  icon: ReactElement;
  tooltipContent: ReactFragment;
  onClick?: MouseEventHandler;
  listIndex: number;
  disabled?: boolean;
};

const ListItem: FC<ListItemProps> = ({
  icon,
  tooltipContent,
  onClick,
  listIndex,
  disabled,
}) => (
  <li
    className={classNames(
      "react-tabs__tab react-tabs__tab--button AnalysisViewer__TabContainer__Tab",
      { "AnalysisViewer__TabContainer__Tab--disabled": disabled }
    )}
    onClick={onClick}
  >
    {icon}
    <SimpleTooltip
      className="AnalysisViewer__ActionButtons__Tooltip"
      style={{
        ["--AnalysisViewer__ActionButtons__Tooltip--index" as any]: listIndex,
      }}
      position="below"
      align="right"
    >
      {tooltipContent}
    </SimpleTooltip>
  </li>
);

export const AnalysisViewerActionButtons: FC<AnalysisViewerActionButtonsProps> = ({
  canCreateNewPlot = false,
  showPlotsModal,
  showOutputMetricsModal,
  canEdit,
}) => {
  if (!canEdit) {
    throw new Error(
      "Should not be rendering analysis viewer action buttons in a read only context"
    );
  }

  const plotTooltip = (
    <>
      <h4>Create new Plot</h4>
      <p>
        {canCreateNewPlot ? (
          <>Use output metrics to create new Plots</>
        ) : (
          <>
            You can't create a new plot without defining at least one metric
            first
          </>
        )}
      </p>
    </>
  );
  return (
    <ul className="react-tabs__tab-list AnalysisViewer__ActionButtons AnalysisViewer__TabContainer__TabList">
      <ListItem
        onClick={showOutputMetricsModal}
        icon={<IconAddDatapoint size={28} />}
        tooltipContent={
          <>
            <h4>Create New Output Metric</h4>
            <p>
              You’ll need to define one or more output metrics in order to
              create a plot
            </p>
          </>
        }
        listIndex={1}
      />
      <ListItem
        onClick={canCreateNewPlot ? showPlotsModal : () => {}}
        icon={<IconCreatePlot size={28} />}
        tooltipContent={plotTooltip}
        disabled={!canCreateNewPlot}
        listIndex={0}
      />
    </ul>
  );
};
