import React, { FC } from "react";

import { IconFileFind } from "../../../Icon";
import { LinkableProject } from "../../../../features/project/types";

export interface HashCoreAccessGateNotFoundProps {
  requestedProject: LinkableProject | null;
}

export const HashCoreAccessGateNotFound: FC<
  HashCoreAccessGateNotFoundProps & { embedded: boolean }
> = ({ requestedProject }) => {
  return (
    <>
      <IconFileFind />
      <h2>Not Found</h2>
      <h3>
        The simulation {requestedProject?.pathWithNamespace} cannot be found.
      </h3>
      <p>
        Find your recent and example projects within the 'File' menu, above.
      </p>
    </>
  );
};
