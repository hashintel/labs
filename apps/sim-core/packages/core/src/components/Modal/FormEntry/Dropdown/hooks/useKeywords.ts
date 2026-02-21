import { useState } from "react";
import { FunctionN } from "fp-ts/es6/function";

import type { Keyword } from "../../../../../util/api/types";
import type { ReactSelectOption } from "../../../../Dropdown/types";

const keywordToOption: FunctionN<[Keyword], ReactSelectOption> = ({
  name,
  count,
}) => ({
  value: name,
  label: name,
  count,
});

export const useKeywords = (
  keywords?: Keyword[],
  existingKeywords: string[] = [],
): [
  ReactSelectOption[],
  ReactSelectOption[],
  (newOptions: ReactSelectOption[]) => void,
] => {
  const options = keywords?.map(keywordToOption) ?? [];
  const [selected, setSelected] = useState(
    options.filter((option) => existingKeywords.includes(option.value)),
  );

  return [options, selected, setSelected];
};
