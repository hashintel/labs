import React, { FC, ReactNode } from "react";
import classNames from "classnames";
import classnames from "classnames";

import { IconAlert } from "../../Icon";
import { ModalFormEntryLabel } from "./ModalFormEntryLabel";
import { ShrinkWrap } from "../../ShrinkWrap/ShrinkWrap";

import "./ModalFormEntry.css";

export interface ModalFormEntryProps {
  label?: ReactNode;
  optional?: boolean;
  flex?: boolean;
  error?: string;
  errorInline?: boolean;
  className?: string;
}

export const ModalFormEntry: FC<ModalFormEntryProps> = ({
  label,
  children,
  optional = false,
  flex = false,
  error = null,
  errorInline = true,
}) => (
  <label
    className={classnames("ModalFormEntry", {
      "ModalFormEntry--flex": flex,
    })}
  >
    {label ? (
      <ModalFormEntryLabel optional={optional}>{label}</ModalFormEntryLabel>
    ) : null}
    <div
      className={classNames("ModalFormEntry__Main", {
        "ModalFormEntry__Main--errorInline": errorInline,
      })}
    >
      <div
        className={classnames("ModalFormEntry_Input", {
          "ModalFormEntry_Input--error": !!error,
        })}
      >
        {children}
        {error && (
          <div className="ModalFormEntry_Input--error__icon">
            <IconAlert />
          </div>
        )}
      </div>
      {error && (
        <div className="ModalFormEntry__Error">
          <div className="ModalFormEntry__Error__Label">WARNING</div>
          <ShrinkWrap
            lineCount={errorInline ? 2 : undefined}
            className="ModalFormEntry__Error__Desc"
            title={error}
            key={error}
          >
            {error}
          </ShrinkWrap>
        </div>
      )}
    </div>
  </label>
);
