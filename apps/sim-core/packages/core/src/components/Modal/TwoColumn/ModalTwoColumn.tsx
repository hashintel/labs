import React, { FC, ReactNode } from "react";
import classNames from "classnames";

import { ModalForm } from "../ModalForm";

import "./ModalTwoColumn.css";

type ModalTwoColumnProps = {
  title: ReactNode;
  intro: ReactNode;
  onSubmit: () => Promise<void>;
  leftChildren: ReactNode;
  rightChildren: ReactNode;
  className?: string;
  disabled?: boolean;
};

/**
 * @deprecated
 */
export const ModalTwoColumnForm: FC<{
  onSubmit: () => Promise<void>;
  disabled: boolean | undefined;
  leftChildren: ReactNode | null;
  rightChildren: ReactNode | null;
}> = ({ onSubmit, disabled, leftChildren, rightChildren }) => (
  <ModalForm onSubmit={onSubmit} disabled={disabled}>
    <div className="ModalTwoColumn__Form__Side">{leftChildren}</div>
    <div className="ModalTwoColumn__Form__Side">{rightChildren}</div>
  </ModalForm>
);

/**
 * @deprecated
 */
export const ModalTwoColumn: FC<ModalTwoColumnProps> = ({
  title,
  intro,
  onSubmit,
  leftChildren,
  rightChildren,
  className,
  disabled = false,
}) => (
  <div className={classNames("ModalTwoColumn", className)}>
    <h2 className="ModalTwoColumn__title">{title}</h2>
    <p className="ModalTwoColumn__intro">{intro}</p>
    <ModalTwoColumnForm
      onSubmit={onSubmit}
      disabled={disabled}
      leftChildren={leftChildren}
      rightChildren={rightChildren}
    />
  </div>
);
