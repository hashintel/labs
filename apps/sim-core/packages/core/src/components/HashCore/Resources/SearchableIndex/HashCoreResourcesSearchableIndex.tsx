import React, { FC } from "react";

import { HashCoreResourcesList } from "..";
import { Search } from "../../../Search";
import { useSearchIndex } from "./hooks";

export const HashCoreResourcesSearchableIndex: FC = () => {
  const { onChange, loading, results, searchTerm } = useSearchIndex();

  return (
    <>
      <Search loading={loading} onChange={onChange} searchTerm={searchTerm} />
      <HashCoreResourcesList results={results} />
    </>
  );
};
