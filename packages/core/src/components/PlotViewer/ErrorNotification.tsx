import React, { FC } from "react";

import { IconAlertOutline } from "../Icon/AlertOutline";

interface ErrorNotificationProps {
  plots: any;
}

const SinglePlot: FC<ErrorNotificationProps> = ({ plots }) => {
  const title = plots[0].plot.definition.title;
  const missingKeys = plots[0].missingKeys;
  return missingKeys.length === 1 ? (
    <ul>
      <li>
        The <em>{title}</em> plot references a non-existent output metric called{" "}
        <pre>"{missingKeys[0]}"</pre>
      </li>
      <li>
        Please <strong>create it</strong>, or alternatively specify another
        output metric to use.
      </li>
    </ul>
  ) : (
    <span>
      The <em>{title}</em> plot references the following non-existent output
      metrics:{" "}
      {missingKeys.map((missingKey: string, index: number) => (
        <div style={{ display: "inline " }} key={`${missingKey}${index}`}>
          <pre>{missingKey}</pre>
          {index < missingKeys.length - 1 ? ", " : ""}
        </div>
      ))}
      .
      <br />
      Please remove these references, or <strong>create these metrics</strong>.
    </span>
  );
};

const MultiPlot: FC<ErrorNotificationProps> = ({ plots }) => {
  const allMissingKeys = plots.flatMap((plot: any) => plot.missingKeys);
  return (
    <span>
      One or more plots reference the following non-existent output metrics:{" "}
      {allMissingKeys.map((missingKey: string, index: number) => (
        <>
          <pre>{missingKey}</pre>
          {index < allMissingKeys.length - 1 ? ", " : ""}
        </>
      ))}
      .
      <br />
      Please remove these references, or <strong>create these metrics</strong>.
    </span>
  );
};

export const ErrorNotification: FC<ErrorNotificationProps> = ({ plots }) => {
  return (
    <div className="PlotViewer__CantDisplayPlot">
      <IconAlertOutline size={32} />
      {plots.length === 1 ? (
        <SinglePlot plots={plots} />
      ) : (
        <MultiPlot plots={plots} />
      )}
    </div>
  );
};
