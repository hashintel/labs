import React, { memo } from "react";
import { Json } from "@hashintel/engine-web";

import { GlobalsRowContainer } from "./GlobalsRowContainer";
import { GlobalsRowField } from "./GlobalsRowField";
import { SharedGlobalsProps } from "./types";

const GlobalsRowInner = <FieldType extends string | number>({
  field,
  value,
  depth,
  ...props
}: SharedGlobalsProps & {
  value: Json;
  field: FieldType;
  onChange: (field: FieldType, value: Json) => void;
}) => (
  <GlobalsRowContainer
    field={field.toString()}
    depth={depth}
    nested={!!value && typeof value === "object"}
  >
    <GlobalsRowField depth={depth} field={field} value={value} {...props} />
  </GlobalsRowContainer>
);
export const GlobalsRow = memo(GlobalsRowInner) as typeof GlobalsRowInner;
