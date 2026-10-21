import React, { FC, MouseEvent } from "react";
import classNames from "classnames";

import "./LabeledInputRadio.css";

type LabeledInputRadioProps = {
  label: string;
  group: string;
  isChecked: (htmlFor: string) => boolean;
  onClick?: (event: MouseEvent<HTMLLabelElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLLabelElement>) => void;
  disabled?: boolean;
};

export const LabeledInputRadio: FC<LabeledInputRadioProps> = ({
  label,
  group,
  isChecked,
  onClick,
  onMouseEnter,
  disabled = false,
}) => {
  const htmlFor = `${group}::${label}`;

  return (
    <>
      <input
        className="LabeledInputRadio-input"
        type="radio"
        name={group}
        id={`${group}::${label}`}
        checked={isChecked(htmlFor)}
        readOnly
      />
      <label
        className={classNames("LabeledInputRadio-label", {
          "LabeledInputRadio-label--disabled": disabled,
        })}
        htmlFor={htmlFor}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        {label}
      </label>
    </>
  );
};
