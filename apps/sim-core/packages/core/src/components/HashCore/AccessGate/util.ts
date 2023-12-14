import { HashCoreAccessGateKind } from "./enums";
import type { HashCoreAccessGateKindWithProps } from "./types";
import { LinkableProject } from "../../../features/project/types";
import { QueryError } from "../../../util/api";

export const queryErrorToAccessGate = (
  { onlyErrorCode: code }: QueryError,
  { requestedProject }: { requestedProject: LinkableProject },
): HashCoreAccessGateKindWithProps | null => {
  /**
   * @todo Support access gates when there are multiple errors
   */
  if (!code) {
    return null;
  }

  switch (code) {
    case "FORBIDDEN":
    case "NOT_FOUND":
    case "BAD_USER_INPUT":
      return {
        kind: HashCoreAccessGateKind.NotFound,
        props: { requestedProject },
      };
  }

  return null;
};
