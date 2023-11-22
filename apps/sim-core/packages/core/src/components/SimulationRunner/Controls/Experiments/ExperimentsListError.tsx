import React, { FC } from "react";
import { useDispatch } from "react-redux";

import { AppDispatch } from "../../../../features/types";
import { IconAlert } from "../../../Icon/Alert";
import { SIM_DOCS_URL } from "../../../../util/api/paths";
import { setCurrentFileId } from "../../../../features/files/slice";

import "./ExperimentsListError.css";

export const ExperimentsListError: FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  return (
    <div className="ExperimentsListError">
      <div className="ExperimentsListError__Text">
        <h3>Couldn't load experiments</h3>
        <p>
          We could not parse your{" "}
          <button
            onClick={(evt) => {
              evt.preventDefault();
              dispatch(setCurrentFileId("experiments"));
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
            rel="noreferrer"
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
