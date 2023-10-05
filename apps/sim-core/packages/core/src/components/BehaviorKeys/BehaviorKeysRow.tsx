import React, { FC, HTMLProps } from "react";
import classNames from "classnames";
import omit from "lodash/omit";

import "./BehaviorKeysRow.scss";

export const BehaviorKeysRow: FC<
  DistributiveOmit<
    | ({ as: "li" } & Omit<HTMLProps<HTMLLIElement>, "as">)
    | ({ as: "div" } & Omit<HTMLProps<HTMLDivElement>, "as">),
    "ref"
  >
> = ({ className, ...props }) => {
  const extraProps = {
    className: classNames("BehaviorKeysRow", className),
  };

  if (props.as === "li") {
    return <li {...extraProps} {...omit(props, "as")} />;
  } else if (props.as === "div") {
    return <div {...extraProps} {...omit(props, "as")} />;
  }

  throw new Error("Unrecognised tag type");
};
