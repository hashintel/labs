import { useState } from "react";

type ValidParamType = string | string[] | boolean;
type TotalParamType = ValidParamType | null | undefined;

export const useParams = <T extends Record<string, TotalParamType>>(
  defaultParams: T,
) => {
  const [params, setParams] = useState<T>(defaultParams);
  const changedParams = Object.entries(params)
    .filter(
      (
        pair: [string, ValidParamType | TotalParamType],
      ): pair is [string, ValidParamType] => {
        const [key, value] = pair;

        return (
          value !== undefined &&
          value !== null &&
          !!key &&
          defaultParams[key] !== value
        );
      },
    )
    .map(([key, value]): [string, string] => [key, value.toString()]);

  return { params, setParams, changedParams };
};
