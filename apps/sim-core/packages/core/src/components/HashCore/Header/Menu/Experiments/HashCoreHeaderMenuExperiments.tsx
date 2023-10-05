import React, { FC, Fragment, memo, MouseEvent } from "react";
import { useSelector } from "react-redux";
import { useModal } from "react-modal-hook";

import { DisabledExperimentTooltip } from "../../../../SimulationRunner/Controls/Experiments/ExperimentsList";
import { ExperimentModal } from "../../../../Modal/Experiments/ExperimentModal";
import { ExperimentTypes } from "../../../../Modal/Experiments/types";
import { LabeledInputRadio } from "../../../../LabeledInputRadio";
import { Scope, useScope } from "../../../../../features/scopes";
import { queueExperiment } from "../../../../../features/simulator/simulate/queueExperiment";
import { selectExperiments } from "../../../../SimulationRunner/Controls/Experiments/selectors";
import { selectProviderTarget } from "../../../../../features/simulator/simulate/selectors";
import { trackEvent } from "../../../../../features/analytics";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../../../features/simulator/context";

type HashCoreHeaderMenuExperimentsProps = {
  openMenuItem: string;
  onClickMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnterMenuItemLabel: ({ target }: MouseEvent<HTMLLabelElement>) => void;
  clearAll: () => void;
};

export const HashCoreHeaderMenuExperiments: FC<HashCoreHeaderMenuExperimentsProps> = memo(
  ({
    openMenuItem,
    onClickMenuItemLabel,
    onMouseEnterMenuItemLabel,
    clearAll,
  }) => {
    const dispatch = useSimulatorDispatch();
    const canEdit = useScope(Scope.edit);
    const experiments = useSelector(selectExperiments);
    const target = useSimulatorSelector(selectProviderTarget);
    const [
      openCreateExperimentModal,
      hideCreateExperimentModal,
    ] = useModal(() => <ExperimentModal onClose={hideCreateExperimentModal} />);

    const items =
      experiments?.map(
        (
          experiment: [string, { description: string; type: ExperimentTypes }]
        ) => {
          const experimentTitle = experiment[0];

          const disabledOptimizationExperiment =
            target !== "cloud" && experiment[1].type === "optimization";
          if (disabledOptimizationExperiment) {
            return (
              <li
                className="HashCoreHeaderMenu-submenu-item HashCoreHeaderMenu-submenu-item--disabled"
                key={experimentTitle}
              >
                <span>{experimentTitle}</span>
                <DisabledExperimentTooltip />
              </li>
            );
          }

          return (
            <li
              className="HashCoreHeaderMenu-submenu-item"
              key={experimentTitle}
            >
              <a
                onClick={() => {
                  clearAll();
                  dispatch(queueExperiment(experimentTitle));
                }}
              >
                {experimentTitle}
              </a>
            </li>
          );
        }
      ) ?? [];

    if (canEdit) {
      items.push(
        <Fragment key="account">
          {items.length ? (
            <li>
              <hr />
            </li>
          ) : null}
          <li className="HashCoreHeaderMenu-submenu-item">
            <a
              onClick={() => {
                clearAll();
                openCreateExperimentModal();
                trackEvent({
                  action: "Experiment wizard opened",
                  label: "Menu",
                });
              }}
            >
              Create new experiment
            </a>
          </li>
        </Fragment>
      );
    }

    return (
      <>
        <LabeledInputRadio
          group="HashCoreHeaderMenu"
          label="Experiments"
          isChecked={(htmlFor) => htmlFor === openMenuItem}
          onClick={onClickMenuItemLabel}
          onMouseEnter={onMouseEnterMenuItemLabel}
          disabled={items.length === 0}
        />
        <ul className="HashCoreHeaderMenu-submenu">{items}</ul>
      </>
    );
  }
);
