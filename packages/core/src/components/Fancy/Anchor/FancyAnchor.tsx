import React, { FC, Children } from "react";
import classNames from "classnames";

import { FancyProps, getIcon } from "..";
import { Link, LinkProps } from "../../Link/Link";

import "../Fancy.scss";
import "./FancyAnchor.css";

export type FancyAnchorProps = FancyProps<HTMLAnchorElement> & LinkProps;

/**
 * @todo remove duplication with FancyButton
 */
export const FancyAnchor: FC<FancyAnchorProps> = ({
  children,
  theme = "white",
  icon,
  size = "regular",
  style,
  onClick = () => undefined,
  className,
  ...props
}) => {
  const numChildren = Children.count(children);

  if (numChildren > 2) {
    throw new Error(
      `FancyAnchor expected no more than 2 children, got ${numChildren}`,
    );
  }

  return (
    <Link
      {...props}
      className={classNames(
        `Fancy FancyAnchor Fancy-${theme} Fancy-${size}`,
        className,
      )}
      style={{
        ...style,
        ...(numChildren === 2 && { height: "62px" }),
        ...(numChildren === 2 && icon && { paddingLeft: "16px" }),
        ...(numChildren !== 2 && icon && { paddingRight: "16px" }),
      }}
      onClick={onClick}
    >
      {numChildren === 2 && icon && getIcon(icon, size)}
      <div className="Fancy-label">{children}</div>
      {numChildren !== 2 && icon && getIcon(icon, size)}
    </Link>
  );
};
