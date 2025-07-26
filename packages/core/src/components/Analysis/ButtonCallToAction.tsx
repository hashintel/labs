import React, { FC } from "react";

import { ButtonCallToActionProps } from "./types";

import "./ButtonCallToAction.scss";

export const ButtonCallToAction: FC<ButtonCallToActionProps> = ({
  children,
  onClick,
}) => (
  <button className="ButtonCallToAction" onClick={onClick}>
    {children}
  </button>
);
