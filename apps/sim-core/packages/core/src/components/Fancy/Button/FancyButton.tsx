import React, { FC, Children, ButtonHTMLAttributes } from "react";
import classNames from "classnames";

import { FancyProps, getIcon } from "..";

import "../Fancy.scss";

export type FancyButtonProps = Omit<
  FancyProps<HTMLButtonElement>,
  "href" | "target"
> &
  Pick<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled">;

/**
 * @todo massively simplify
 */
export const FancyButton: FC<FancyButtonProps> = ({
  children,
  theme = "white",
  icon,
  size = "regular",
  style,
  onClick = () => undefined,
  className,
  type = "button",
  disabled = false,
}) => {
  const numChildren = Children.count(children);

  if (numChildren > 2) {
    throw new Error(
      `FancyButton expected no more than 2 children, got ${numChildren}`
    );
  }

  return (
    <button
      className={classNames(
        `Fancy Fancy-${theme} Fancy-${size} Fancy-${icon}`,
        { "Fancy-no-label": numChildren === 0 },
        className
      )}
      style={{
        ...style,
        ...(numChildren === 2 && { height: "62px" }),
        ...(numChildren === 2 && icon && { paddingLeft: "16px" }),
        ...(numChildren === 1 && icon && { paddingRight: "16px" }),
      }}
      onClick={onClick}
      type={type}
      disabled={disabled}
    >
      {numChildren === 2 && icon && getIcon(icon, size)}
      <div className="Fancy-label">{children}</div>
      {numChildren !== 2 && icon && getIcon(icon, size)}
    </button>
  );
};
