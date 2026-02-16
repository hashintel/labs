import { getSafeQueryParams } from "./getSafeQueryParams";

export type ValidatedEmbedParams = {
  project: string;
  ref: string;
};

const validateEmbedParams = (
  params: Record<string, string>
): params is ValidatedEmbedParams =>
  typeof params.project === "string" && typeof params.ref === "string";

export const getEmbedParams = () => {
  const params = getSafeQueryParams();

  if (!validateEmbedParams(params)) {
    // @todo handle this
    throw new Error("Embedded core not properly configured");
  }

  return params;
};
