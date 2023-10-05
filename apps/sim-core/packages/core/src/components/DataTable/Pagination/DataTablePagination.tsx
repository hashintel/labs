import React, { FC, Dispatch, SetStateAction, memo } from "react";

import { FancyButton } from "../../Fancy";

import "./DataTablePagination.css";

type DataTablePaginationProps = {
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
};

export const DataTablePagination: FC<DataTablePaginationProps> = memo(
  ({ currentPage, setCurrentPage, totalPages }) => (
    <div className="DataTablePagination">
      <FancyButton
        icon="arrowLeftBold"
        theme="black"
        disabled={currentPage === 0}
        onClick={() =>
          setCurrentPage(Math.min(Math.max(0, currentPage - 1), totalPages - 1))
        }
      />
      {currentPage + 1} / {totalPages}
      <FancyButton
        icon="arrowRightBold"
        theme="black"
        disabled={currentPage === totalPages - 1}
        onClick={() =>
          setCurrentPage(Math.min(Math.max(0, currentPage + 1), totalPages - 1))
        }
      />
    </div>
  )
);
