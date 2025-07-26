import React, { FC, memo } from "react";

import { DataTableCell } from "../Cell";

interface DataTableRowProps {
  rowIndex: number;
  record: any[];
}

export const DataTableRow: FC<DataTableRowProps> = memo(
  ({ rowIndex, record }) => (
    <tr className="DataTableRow">
      <DataTableCell cellValue={rowIndex} />
      {record.map((value, idx) => (
        <DataTableCell key={`data-${rowIndex}-${idx}`} cellValue={value} />
      ))}
    </tr>
  ),
);
