import React, { FC } from "react";

import { ExperimentTypes } from "./types";
import { IconInformationOutline } from "../../Icon";
import { SimpleTooltip } from "../../SimpleTooltip";

const BASE_DOCS_URL =
  "https://docs.hash.ai/core/creating-simulations/experiments/";

const BASE_REGULAR_EXP_URL = `${BASE_DOCS_URL}experiment-types`;

type ExperimentTypeHints = Record<
  ExperimentTypes,
  { description: string; docsUrl: string }
>;

const EXPERIMENT_TYPE_HINTS: ExperimentTypeHints = {
  values: {
    description:
      "Value sweeping runs a simulation for each of the specified values.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#value-sweep`,
  },
  linspace: {
    description:
      "Fixed sample sweeping or 'linspace' is one of the most common types of parameter sweeps. Define start, stop, and number of samples to generate an even sampling between two values with a set number of data points.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#fixed-sample-sweep-linspace`,
  },
  arange: {
    description:
      "Instead of using a set number of samples like linspace, arange samples every 'increment' between the specified start and stop fields.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#fixed-step-sweep`,
  },
  "monte-carlo": {
    description:
      "Monte Carlo sweeping allows random sampling from a custom distribution. Each supported distribution can be customized through the associated parameters.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#monte-carlo-sweep`,
  },
  group: {
    description: "You can run groups of experiments together at the same time.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#group-sweep`,
  },
  multiparameter: {
    description:
      "In order to discover interaction effects in your model, you'll have to perform sweeps over multiple parameters. The multiparameter experiment generates a full factorial design with all of the specified experiments.",
    docsUrl: `${BASE_REGULAR_EXP_URL}#multiparameter-sweep`,
  },
  optimization: {
    description:
      "With HASH's optimization engine, you can automatically generate simulations and find the set of parameters that will maximize or minimize a metric.",
    docsUrl: `${BASE_DOCS_URL}optimization-experiments`,
  },
};

export const ExperimentTypeTooltip: FC<{ type: ExperimentTypes }> = ({
  type,
}) => (
  <div className="ExperimentModal__TypeDropdown_TooltipContainer">
    <a
      href={EXPERIMENT_TYPE_HINTS[type].docsUrl}
      target="_blank"
      rel="noreferrer"
    >
      <IconInformationOutline size={28} />
    </a>
    <SimpleTooltip
      allRoundedBorders
      className="ExperimentModal__TypeDropdown_Tooltip"
      inModal
      interactive
      position="below"
    >
      {EXPERIMENT_TYPE_HINTS[type].description}
      <br />
      <br />
      <a
        href={EXPERIMENT_TYPE_HINTS[type].docsUrl}
        target="_blank"
        rel="noreferrer"
      >
        Read more.
      </a>
    </SimpleTooltip>
  </div>
);
