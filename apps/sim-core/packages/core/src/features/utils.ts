import { AnyAction, Middleware } from "redux";
import { Subject } from "rxjs";

import { PartialSimulationProject } from "./project/types";

export const projectUpdatedSort = (
  a: PartialSimulationProject,
  b: PartialSimulationProject
) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();

export const observeMiddleware = <T>(
  subject: Subject<AnyAction>
): Middleware<{}, T> => () => (next) => (action) => {
  const result = next(action);
  subject.next(action);
  return result;
};

// @todo remove this
export const isCompleteErrorMessage = (message: string) =>
  message.includes("_HASH_PRIVATE_TEMPORARY_COMPLETE_ERROR");
