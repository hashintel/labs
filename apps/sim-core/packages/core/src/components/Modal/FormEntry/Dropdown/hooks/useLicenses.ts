import { useState } from "react";
import { FunctionN } from "fp-ts/es6/function";

import type { License } from "../../../../../util/api/types";
import type { ReactSelectOption } from "../../../../Dropdown/types";

const licenceToOption: FunctionN<[License], ReactSelectOption> = ({
  id,
  name,
  default: isDefault,
}) => ({
  value: id,
  label: isDefault ? `${name} (default)` : name,
});

export const useLicenses = (
  licenses?: License[],
  setDefaultLicense?: Pick<License, "id"> | null,
): [
  ReactSelectOption[],
  ReactSelectOption,
  (option: ReactSelectOption) => void,
] => {
  const options = licenses?.map(licenceToOption) ?? [];
  const defaultLicense =
    setDefaultLicense ?? licenses?.find((license) => license.default);
  const defaultOption = defaultLicense
    ? options.find((option) => option.value === defaultLicense.id)
    : undefined;

  if (!defaultOption) {
    throw new Error("Cannot find default license");
  }

  const [selected, setSelected] = useState(defaultOption);

  return [options, selected, setSelected];
};
