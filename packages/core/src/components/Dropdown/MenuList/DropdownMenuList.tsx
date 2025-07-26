import React, { FC, useRef, useEffect, Children } from "react";
import { VariableSizeList } from "react-window";

import type { ReactSelectOption } from "../types";

interface DropdownMenuListProps {
  options: ReactSelectOption[];
}

/**
 * these numbers are kinda magic numbers, it's known and tolerated for
 * expediency's sake, the occur here and in the hash.ai repo
 *
 * @see https://github.com/hashintel/internal/issues/780
 * @see https://github.com/hashintel/hash.ai/blob/master/src/components/Dropdown.tsx#L82-L88
 */
const SUB_LABEL_MIN_SIZE = 36;
const SUB_LABEL_AVG_LENGTH = 55;
const SUB_LABEL_AVG_SIZE = 46;
const SUB_LABEL_MAX_SIZE = 60;
const LIST_HEIGHT = 200;

export const DropdownMenuList: FC<DropdownMenuListProps> = ({
  options,
  children,
}) => {
  const listRef = useRef<VariableSizeList>(null);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }

    listRef.current.resetAfterIndex(0, true);
  }, [children, Children.count(children)]);

  const calculateSize = (idx: number) => {
    const subLabel = options[idx]?.subLabel;

    return !subLabel || subLabel.length === 0
      ? SUB_LABEL_MIN_SIZE
      : subLabel.length < SUB_LABEL_AVG_LENGTH
        ? SUB_LABEL_AVG_SIZE
        : SUB_LABEL_MAX_SIZE;
  };

  return (
    <VariableSizeList
      ref={listRef}
      width="100%"
      height={LIST_HEIGHT}
      estimatedItemSize={SUB_LABEL_AVG_SIZE}
      itemCount={Children.count(children)}
      itemSize={calculateSize}
    >
      {({ index, style }) => (
        <div style={style}>{Children.toArray(children)[index]}</div>
      )}
    </VariableSizeList>
  );
};
