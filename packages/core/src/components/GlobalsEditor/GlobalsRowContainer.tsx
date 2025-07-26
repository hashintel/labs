import React, { FC, useState } from "react";
import classNames from "classnames";

export const GlobalsRowContainer: FC<{
  field: string;
  nested?: boolean;
  depth: number;
}> = ({ field, nested = false, children, depth }) => {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={classNames("GlobalsRowContainer", {
        "GlobalsRowContainer--nested": nested,
        "GlobalsRowContainer--even": depth % 2 === 0,
        "GlobalsRowContainer--odd": depth % 2 !== 0,
      })}
    >
      {nested ? (
        <div
          className="GlobalsRowContainer__Item GlobalsRowContainer__Heading"
          onClick={(evt) => {
            evt.preventDefault();
            setOpen((open) => !open);
          }}
        >
          <span
            className={classNames("codicon", {
              "codicon-chevron-down": open,
              "codicon-chevron-right": !open,
            })}
          />
          <span className="GlobalsRowContainer__Title">{field}</span>
        </div>
      ) : (
        <label title={field} className="GlobalsRowContainer__Item">
          <span className="GlobalsRowContainer__Title">{field}</span>
          {children}
        </label>
      )}
      {nested && open ? (
        <div className="GlobalsRowContainer__Child">{children}</div>
      ) : null}
    </div>
  );
};
