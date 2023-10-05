import React, { FC, memo, useCallback, useEffect, useRef } from "react";
import { Json, JsonArray } from "@hashintel/engine-web";

import { GlobalsRow } from "./GlobalsRow";
import { SharedGlobalsProps } from "./types";
import { getChildSchema } from "./utils";

export const GlobalsArray: FC<
  SharedGlobalsProps & {
    value: JsonArray;
    onChange: (value: JsonArray) => void;
  }
> = memo(function GlobalsJsonArrayInner({ value, schema, onChange, depth }) {
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  });

  const onFieldChange = useCallback(
    (field: number, value: Json) => {
      const newArray = [...valueRef.current];

      newArray[field] = value;

      onChange(newArray);
    },
    [onChange]
  );

  const items = schema?.items;
  const itemsArray = Array.isArray(items) ? items : undefined;
  const itemsSingle = Array.isArray(items) ? undefined : items;

  return (
    <>
      {value.map((item, idx) =>
        item !== null && item !== undefined ? (
          <GlobalsRow
            key={idx}
            schema={getChildSchema(itemsArray?.[idx] ?? itemsSingle)}
            field={idx}
            value={item}
            onChange={onFieldChange}
            depth={depth}
          />
        ) : null
      )}
    </>
  );
});
