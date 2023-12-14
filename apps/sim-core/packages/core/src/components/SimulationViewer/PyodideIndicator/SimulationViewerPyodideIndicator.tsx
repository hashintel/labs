import React, { FC } from "react";

import { IconPython, IconSpinner } from "../../Icon";

import "./SimulationViewierPyodideIndicator.css";

export const SimulationViewerPyodideIndicator: FC<{
  pyodideEnabled: boolean;
}> = ({ pyodideEnabled: pyodideEnabled }) => (
  <div className="SimulationViewerPyodideIndicator">
    {!pyodideEnabled ? <IconPython /> : <IconSpinner />}
    <div className="SimulationViewerPyodideIndicator__Label">
      {!pyodideEnabled ? (
        <>
          <strong>
            Simulations containing Python Behaviors can’t be
            <br />
            run locally using this version of Safari.
          </strong>
          <br />
          <br />
          To run this simulation in Safari,
          <br />
          launch an{" "}
          <a
            href="https://docs.hash.ai/core/creating-simulations/experiments"
            target="_blank"
            rel="noreferrer"
          >
            experiment
          </a>{" "}
          with 'Cloud Active' on,
          <br />
          or switch to Chrome/Firefox to run locally.
        </>
      ) : (
        <>
          We're getting ready to
          <br />
          run your Python code now…
        </>
      )}
    </div>
  </div>
);
