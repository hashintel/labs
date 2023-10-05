import React, { FC, ReactNode } from "react";
import classNames from "classnames";

export const NewProjectField: FC<{
  focused: boolean;
  error?: boolean;
  name: string;
  fieldName: string;
  tip?: ReactNode;
  showTip?: boolean;
}> = ({
  focused,
  error = false,
  name,
  fieldName,
  children,
  showTip = false,
}) => (
  <div
    className={classNames("ModalNewProject__Field", {
      "ModalNewProject__Field--error": error,
      "ModalNewProject__Field--focused": focused,
      "ModalNewProject__Field--showTip": showTip,
    })}
  >
    <div className="ModalNewProject__Field__Top">
      <label htmlFor={fieldName}>{name}</label>
    </div>
    <div className="ModalNewProject__Field__Bottom">{children}</div>
  </div>
);
