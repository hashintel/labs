import React, { FC } from "react";
import { useSelector } from "react-redux";
import urljoin from "url-join";

import {
  BackButton,
  Button,
  Buttons,
  KeyboardSupport,
  ProgressIndicator,
} from "./util";
import { SITE_URL } from "../../../../util/api/paths";
import { selectUserProfileUrl } from "../../../../features/user/selectors";

export const HashCoreTourStepDatasets: FC = () => {
  const url = useSelector(selectUserProfileUrl);

  return (
    <>
      <KeyboardSupport />
      <p>
        To tailor a simulation with real-world data,{" "}
        <a
          href="https://docs.hash.ai/core/creating-simulations/datasets"
          target="_blank"
          rel="noreferrer"
        >
          you can import datasets to customize your agents and behaviors
        </a>
        . Data, behaviors, and simulations that others users have shared are
        also available in{" "}
        <a href={urljoin(SITE_URL, "@hash")} target="_blank" rel="noreferrer">
          HASH
        </a>
        , which you can add to your own simulations.
      </p>
      <p>
        Your simulation and datasets are auto-saved to your{" "}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            profile
          </a>
        ) : (
          <>profile</>
        )}
        , where you can share them with the world!
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
