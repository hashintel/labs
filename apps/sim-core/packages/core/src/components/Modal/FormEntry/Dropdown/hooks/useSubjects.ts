import { useState } from "react";
import { FunctionN } from "fp-ts/es6/function";

import type { ReactSelectOption } from "../../../../Dropdown/types";
import type { Subject } from "../../../../../util/api/types";

const subjectsToOptions: FunctionN<[Subject], ReactSelectOption> = ({
  id,
  name,
  parentChain,
}) => ({
  value: id,
  label: name,
  subLabel: parentChain,
});

export const useSubjects = (
  subjects?: Subject[],
): [
  ReactSelectOption[],
  ReactSelectOption[],
  (newSubjects: ReactSelectOption[]) => void,
] => {
  const options = subjects?.map(subjectsToOptions) ?? [];
  const [selected, setSelected] = useState<ReactSelectOption[]>([]);

  return [options, selected, setSelected];
};
