import React, { FC, InputHTMLAttributes } from "react";
import classnames from "classnames";

import { IconCheck } from "../../Icon/Check";

import "./CheckboxInput.css";

export const CheckboxInput: FC<
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
> = (props) => (
  <div
    className={classnames({
      CheckboxInput: true,
      "CheckboxInput--disabled": props.disabled,
    })}
  >
    <input type="checkbox" {...props} />
    <div className="CheckboxInput__Fake">
      <IconCheck size={18} />
    </div>
  </div>
);
