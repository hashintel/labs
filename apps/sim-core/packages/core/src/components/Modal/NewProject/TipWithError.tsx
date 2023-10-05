import React, { FC, ReactNode } from "react";
import classNames from "classnames";

import { ShrinkWrap } from "../../ShrinkWrap/ShrinkWrap";

export const TipWithError: FC<{ tip: ReactNode; error?: ReactNode }> = ({
  tip,
  error,
}) => (
  <div
    className={classNames("ModalNewProject__Field__Tip", {
      "ModalNewProject__Field__Tip--withError": !!error,
    })}
  >
    <span>{tip}</span>
    {error ? (
      <ShrinkWrap lineCount={2} className="ModalNewProject__Field__Error">
        {error}
      </ShrinkWrap>
    ) : null}
  </div>
);
