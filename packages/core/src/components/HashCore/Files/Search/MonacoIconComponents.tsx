import React, { FC, HTMLProps } from "react";
import classnames from "classnames";

import "./MonacoIconComponents.scss";

type MonacoIconProps = Omit<HTMLProps<HTMLDivElement>, "title" | "onClick"> & {
  iconName: string;
  title: string;
  onClick: VoidFunction;
};

const MonacoIcon: FC<MonacoIconProps> = ({
  className,
  onClick,
  role,
  title,
  iconName,
  disabled,
  ...props
}) => (
  <div
    {...props}
    title={title}
    className={classnames("codicon", `codicon-${iconName}`, className, {
      disabled,
    })}
    role={role}
    aria-label={title}
    aria-disabled={disabled}
    onClick={(evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (!disabled) {
        onClick();
      }
    }}
  />
);

export const MonacoIconButton: FC<Omit<MonacoIconProps, "open">> = ({
  title,
  iconName,
  className,
  ...props
}) => (
  <MonacoIcon
    {...props}
    title={title}
    iconName={iconName}
    className={classnames(className, "button")}
    role="button"
  />
);

export const MonacoIconCheckbox: FC<
  Omit<MonacoIconProps, "onClick"> & {
    checked: boolean;
    onClick: (checked: boolean) => void;
  }
> = ({ checked, title, onClick, className, ...props }) => (
  <MonacoIcon
    {...props}
    title={title}
    className={classnames(className, "monaco-custom-checkbox", {
      checked: checked,
      unchecked: !checked,
    })}
    role="checkbox"
    onClick={() => {
      onClick(checked);
    }}
    aria-checked={checked}
  />
);

export const MonacoIconToggle: FC<
  Omit<MonacoIconProps, "onClick" | "iconName"> & {
    open: boolean;
    onClick: (open: boolean) => void;
  }
> = ({ open, onClick, className, ...props }) => (
  <MonacoIconButton
    {...props}
    iconName={open ? "chevron-down" : "chevron-right"}
    className={classnames(className, "toggle")}
    onClick={() => {
      onClick(open);
    }}
    aria-expanded={open}
  />
);
