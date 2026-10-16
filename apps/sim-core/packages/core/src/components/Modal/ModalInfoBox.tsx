import React, { FC, PropsWithChildren } from "react";
import classNames from "classnames";

import { IconAlertOutline, IconInformationOutline } from "../Icon";

import "./ModalInfoBox.scss";

export const ModalInfoBox: FC<
  PropsWithChildren<{
    type?: "info" | "warning";
    className?: string;
  }>
> = ({ type = "info", children, className }) => (
  <div
    className={classNames("ModalInfoBox", `ModalInfoBox--${type}`, className)}
  >
    {type === "info" ? (
      <IconInformationOutline size={24} />
    ) : (
      <IconAlertOutline size={24} />
    )}
    <p>{children}</p>
  </div>
);
