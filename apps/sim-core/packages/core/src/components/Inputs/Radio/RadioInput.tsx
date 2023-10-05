import React, { FC, InputHTMLAttributes } from "react";
import classnames from "classnames";

import { IconCheck } from "../../Icon";

import "./RadioInput.scss";

export type RadioInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "tick"
> & {
  tick?: boolean;
};

export const RadioInput: FC<RadioInputProps> = ({ tick, ...props }) => (
  <div
    className={classnames({
      RadioInput: true,
      "RadioInput--disabled": props.disabled,
      "RadioInput--tick": tick,
    })}
  >
    <input type="radio" {...props} />
    <div className="RadioInput__Fake">
      {tick ? <IconCheck size={14} /> : null}
    </div>
  </div>
);
