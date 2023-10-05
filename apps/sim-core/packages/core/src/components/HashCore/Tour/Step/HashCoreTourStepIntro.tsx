import React, { FC } from "react";

import { Button, Buttons, useKeyboardSupport } from "./util";
import { useConfigHashTourForSlide } from "../react-shepherd-wrapper";

export const HashCoreTourStepIntro: FC = () => {
  useConfigHashTourForSlide({
    shouldCenter: true,
    shouldShowBackdrop: true,
  });

  useKeyboardSupport(false, true);

  return (
    <>
      <p>
        <strong>Welcome to HASH Core</strong>, our simulation development and
        experimentation environment.
      </p>
      <p>
        <em>
          You can replay this tutorial at anytime by selecting ‘New user tour’
          from the help menu.
        </em>
      </p>
      <Buttons>
        <Button type="next">Click here to get started (2-min tour)</Button>
      </Buttons>
    </>
  );
};
