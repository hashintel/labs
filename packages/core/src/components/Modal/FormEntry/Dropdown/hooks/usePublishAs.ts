import { useState } from "react";
import { FunctionN } from "fp-ts/es6/function";

import type { Org } from "../../../../../util/api/types";
import type { ReactSelectOption } from "../../../../Dropdown/types";

const publishAsToOptions: FunctionN<[Org], ReactSelectOption> = ({
  id,
  shortname,
  name,
}) => ({
  value: id,
  label: name,
  subLabel: shortname,
});

export const usePublishAs = (
  publishAs?: Org[],
  currentNamespace?: string,
): [
  ReactSelectOption[],
  ReactSelectOption,
  (setOrg: ReactSelectOption) => void,
] => {
  const defaultOrg =
    (currentNamespace
      ? publishAs?.find((org) => org.shortname === currentNamespace)
      : null) ?? publishAs?.[0];

  const options = publishAs?.map(publishAsToOptions) ?? [];
  const defaultValue = options?.find(
    (option) => option.subLabel === defaultOrg?.shortname,
  );

  if (!defaultValue) {
    throw new Error("Cannot find default publish as");
  }

  const [value, setValue] = useState(defaultValue);

  return [options, value, setValue];
};
