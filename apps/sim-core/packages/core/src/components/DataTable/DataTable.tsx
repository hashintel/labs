import React, { FC, memo, useState } from "react";

import { DataTableBody, DataTableHead, DataTablePagination } from ".";

import "./DataTable.css";

type DataTableProps = {
  headings: string[];
  records: any[][];
  recordsPerPage?: number;
};

export const DataTable: FC<DataTableProps> = memo(
  ({ headings, records, recordsPerPage = 50 }) => {
    const [currentPage, setCurrentPage] = useState(0);
    const totalPages = Math.ceil(records.length / recordsPerPage);

    return (
      <div className="DataTable__container">
        <div className="DataTable--min-height-fix">
          <table className="DataTable">
            <DataTableHead headings={headings} />
            <DataTableBody
              beginIndex={currentPage * recordsPerPage}
              records={records.slice(
                currentPage * recordsPerPage,
                (currentPage + 1) * recordsPerPage
              )}
            />
          </table>
        </div>
        {totalPages > 1 && (
          <DataTablePagination
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
          />
        )}
      </div>
    );
  }
);
