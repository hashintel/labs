import React, { useCallback } from "react";
import { Json, JsonArray, JsonMap } from "@hashintel/engine-web";

import { EnumInput } from "../Inputs/EnumInput";
import { GlobalsArray } from "./GlobalsArray";
import { GlobalsObject } from "./GlobalsObject";
import { SharedGlobalsProps } from "./types";
import { TextOrNumberInput } from "../Inputs/TextOrNumberInput";
import { parseNumber } from "./utils";

export const GlobalsRowField = <FieldType extends string | number>({
  field,
  value,
  schema,
  onChange,
  depth,
}: SharedGlobalsProps & {
  value: Json;
  field: FieldType;
  onChange: (field: FieldType, value: Json) => void;
  depth: number;
}) => {
  const onChildMapChange = useCallback(
    (json: JsonMap | JsonArray) => {
      onChange(field, json);
    },
    [onChange, field],
  );

  const fieldName = field.toString();

  if (schema?.enum) {
    return (
      <EnumInput
        name={fieldName}
        value={value?.toString() ?? ""}
        options={schema?.enum as string[]}
        onChange={(value) => {
          onChange(field, value);
        }}
      />
    );
  }

  if (Array.isArray(value)) {
    return (
      <GlobalsArray
        schema={schema}
        value={value}
        onChange={onChildMapChange}
        depth={depth + 1}
      />
    );
  }

  if (value !== null) {
    switch (typeof value) {
      case "object":
        return (
          <GlobalsObject
            schema={schema}
            value={value}
            onChange={onChildMapChange}
            depth={depth + 1}
          />
        );
      case "string":
      case "number":
        return (
          <TextOrNumberInput
            value={parseNumber(value, schema?.type)}
            min={schema?.minimum}
            max={schema?.maximum}
            step={schema?.multipleOf}
            type={
              schema?.type === "number"
                ? "number"
                : schema?.type === "string"
                  ? "string"
                  : null
            }
            onChange={(value) => {
              onChange(field, parseNumber(value, schema?.type));
            }}
          />
        );
      case "boolean":
        return (
          <input
            type="checkbox"
            checked={value}
            onChange={(evt) => {
              onChange(field, evt.target.checked);
            }}
          />
        );
    }
  }

  return <span>{JSON.stringify(value)}</span>;
};
