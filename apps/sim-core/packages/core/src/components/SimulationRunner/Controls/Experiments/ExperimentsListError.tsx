import React, { FC } from "react";

import { IconAlert } from "../../../Icon/Alert";
import { SIM_DOCS_URL } from "../../../../util/api/paths";
import { useFiles } from "../../../../features/files/FilesContext";

import "./ExperimentsListError.css";

export const ExperimentsListError: FC = () => {
  const { setCurrentFileId } = useFiles();
  return (
    <div className="ExperimentsListError">
      <div className="ExperimentsListError__Text">
        <h3>Couldn't load experiments</h3>
        <p>
          We could not parse your{" "}
          <button
            onClick={(evt) => {
              evt.preventDefault();
              setCurrentFileId("experiments");
            }}
          >
            experiments.json
          </button>{" "}
          file.
          <br />
          Check out{" "}
          <a
            href={`${SIM_DOCS_URL}/creating-simulations/experiments`}
            target="_blank"
          >
            our docs
          </a>{" "}
          for more help.
        </p>
      </div>
      <IconAlert size={120} />
    </div>
  );
};
