import React, { FC } from "react";

import { HashCoreFiles, HashCoreResources } from "..";
import { HashCoreFilesSearchContainer } from "../Files/Search";
import { Scope, useScope } from "../../../features/scopes";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";

import "./HashCoreAside.css";

export const HashCoreAside: FC = () => {
  const canSave = useScope(Scope.save);
  return (
    <aside className="HashCoreAside">
      <WrappedSplitterLayout
        customClassName="aside-splitter"
        vertical={true}
        percentage={true}
        primaryMinSize={20}
        secondaryMinSize={20}
        secondaryHidden={!canSave || true} // migration shim.
      >
        <HashCoreFiles />
        <HashCoreResources />
      </WrappedSplitterLayout>
      <HashCoreFilesSearchContainer />
    </aside>
  );
};
