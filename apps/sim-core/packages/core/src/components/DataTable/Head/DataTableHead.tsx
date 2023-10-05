import React, { FC, memo } from "react";
import { kebabCase } from "lodash";

import "./DataTableHead.css";

type DataTableHeadProps = {
  headings: string[];
};

export const DataTableHead: FC<DataTableHeadProps> = memo(({ headings }) => (
  <>
    <colgroup>
      <col />
      {headings.map((heading, idx) => (
        <col key={`heading-${kebabCase(heading)}-${idx}`} />
      ))}
    </colgroup>
    <thead className="DataTableHead">
      <tr>
        <th scope="col" />
        {headings.map((heading, idx) => (
          <th key={`heading-${kebabCase(heading)}-${idx}`} scope="col">
            {heading}
          </th>
        ))}
      </tr>
    </thead>
  </>
));
