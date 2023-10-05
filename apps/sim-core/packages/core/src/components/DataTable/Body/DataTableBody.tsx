import React, { FC, memo } from "react";

import { DataTableRow } from "..";

import "./DataTableBody.css";

type DataTableBodyProps = {
  beginIndex: number;
  records: any[][];
};

export const DataTableBody: FC<DataTableBodyProps> = memo(
  ({ beginIndex, records }) => (
    <tbody className="DataTableBody">
      {records.map((record, idx) => (
        <DataTableRow
          key={`row-${beginIndex + idx}`}
          rowIndex={beginIndex + idx}
          record={record}
        />
      ))}
    </tbody>
  )
);
