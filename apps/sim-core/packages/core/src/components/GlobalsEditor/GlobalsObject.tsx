import React, {
  FC,
  memo,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { Json, JsonMap } from "@hashintel/engine-web";

import { GlobalsRow } from "./GlobalsRow";
import { SharedGlobalsProps } from "./types";
import { getChildSchema } from "./utils";

export const GlobalsObject: FC<
  SharedGlobalsProps & {
    value: JsonMap;
    emptyMessage?: ReactElement | null;
    onChange: (globals: JsonMap) => void;
    filterField?: (field: string) => boolean;
    depth: number;
  }
> = memo(function GlobalsObjectInner({
  value,
  onChange,
  emptyMessage = null,
  filterField = () => true,
  schema,
  ...props
}) {
  const globalsList = Object.entries(value);

  const jsonRef = useRef(value);

  useEffect(() => {
    jsonRef.current = value;
  });

  const onFieldChange = useCallback(
    (field: string, value: Json) => {
      onChange({
        ...jsonRef.current,
        [field]: value,
      });
    },
    [onChange]
  );

  return globalsList.length ? (
    <>
      {globalsList.map(([field, val]) =>
        filterField(field) ? (
          <GlobalsRow
            key={field}
            value={val}
            field={field}
            onChange={onFieldChange}
            schema={getChildSchema(schema?.properties?.[field])}
            {...props}
          />
        ) : null
      )}
    </>
  ) : (
    emptyMessage
  );
});
