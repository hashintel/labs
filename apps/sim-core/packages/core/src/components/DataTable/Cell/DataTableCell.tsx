import React, { FC, memo, ReactNode } from "react";
import classNames from "classnames";

import { IconCheck, IconClose } from "../../Icon";

import "./DataTableCell.css";

interface DataTableCellProps {
  cellValue: any;
}

enum TypeOf {
  Undefined = "undefined",
  Object = "object",
  Boolean = "boolean",
  Number = "number",
  BigInt = "bigint",
  String = "string",
  Symbol = "symbol",
  Function = "function",
}

const cell: { [type in TypeOf]: (value: any) => ReactNode } = {
  [TypeOf.Undefined]: () => <span className="empty-value">-</span>,
  [TypeOf.Object]: (value) => {
    if (value === null) {
      return <span className="empty-value">-</span>;
    }

    if (Array.isArray(value)) {
      if (value.every((val) => typeof val === "string")) {
        return (
          <span className="overflowable-string" title={value.join(",")}>
            {value.join(", ")}
          </span>
        );
      }

      // this makes the somewhat *bold* assumption that any array of 3 numbers
      // between 0 and 255 is an rgb value
      if (
        value.length === 3 &&
        value.every((val) => typeof val === "number" && 0 <= val && val <= 255)
      ) {
        return (
          <span
            style={{
              background: `rgb(${value.join(",")})`,
            }}
            title={`rgb(${value.join(",")})`}
          >
            {value.join(", ")}
          </span>
        );
      }
    }

    return (
      <pre>
        <code>{JSON.stringify(value)}</code>
      </pre>
    );
  },
  [TypeOf.Boolean]: (value) =>
    value ? <IconCheck size={14} /> : <IconClose />,
  [TypeOf.Number]: (value) => value,
  [TypeOf.String]: (value) => (
    <span className={classNames({ "empty-value": value === "" })}>
      {value || "-"}
    </span>
  ),
  // currently unhandled, but left in for completeness sake, at time of writing
  // this cell only deals with JSON.parse-able values and I don't think these
  // types can be extracted from a JSON string
  [TypeOf.BigInt]: () => null,
  [TypeOf.Symbol]: () => null,
  [TypeOf.Function]: () => null,
};

export const DataTableCell: FC<DataTableCellProps> = memo(
  ({ cellValue: value }) => (
    <td
      className={classNames(["DataTableCell", `DataTableCell-${typeof value}`])}
    >
      {cell[typeof value](value)}
    </td>
  ),
);
