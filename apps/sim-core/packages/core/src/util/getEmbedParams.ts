import { HookRouter } from "hookrouter";

import {
  ParseAccessCodeParam,
  parseAccessCodeInParams,
} from "./parseAccessCodeInParams";
import { ProjectAccessScope } from "../shared/scopes";
import { getSafeQueryParams } from "./getSafeQueryParams";

export type ValidatedEmbedParams = {
  project: string;
  ref: string;
} & ParseAccessCodeParam;

const validateEmbedParams = (
  params: ParseAccessCodeParam & HookRouter.QueryParams
): params is ValidatedEmbedParams =>
  typeof params.project === "string" && typeof params.ref === "string";

export const getEmbedParams = () => {
  const params = parseAccessCodeInParams(
    getSafeQueryParams(),
    ProjectAccessScope.ReadEmbed
  );

  if (!validateEmbedParams(params)) {
    // @todo handle this
    throw new Error("Embedded core not properly configured");
  }

  return params;
};
