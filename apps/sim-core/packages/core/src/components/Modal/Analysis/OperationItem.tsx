import React, { FC } from "react";
import classNames from "classnames";

import {
  ComparisonTypes,
  Operation,
  OperationItemProps,
  OperationTypes,
} from "../../Analysis/types";
import { IconTrash } from "../../Icon/Trash";
import {
  ModalFormEntryDropdown,
  ModalFormEntryRequiredText,
} from "../FormEntry";
import { ReactSelectOption } from "../../Dropdown/types";

const comparisonOptions: ReactSelectOption[] = [
  ComparisonTypes.eq,
  ComparisonTypes.neq,
  ComparisonTypes.lt,
  ComparisonTypes.lte,
  ComparisonTypes.gt,
  ComparisonTypes.gte,
].map((item) => ({
  value: item,
  label: item,
}));

const operationSupportsFieldField = (OpType: OperationTypes) =>
  OpType === OperationTypes.filter || OpType === OperationTypes.get;
const operationSupportsComparisonField = (OpType: OperationTypes) =>
  OpType === OperationTypes.filter;
const operationSupportsValueField = (OpType: OperationTypes) =>
  OpType === OperationTypes.filter;

export const OperationItem: FC<OperationItemProps> = ({
  operation,
  index,
  onDelete,
  onChange,
  permittedOperations,
  hideDelete = false,
  behaviorKeysOptions = [],
}) => {
  const filterPropertiesBasedOnOperationType = (
    OpType: OperationTypes,
    newValues: Operation
  ) => {
    if (operationSupportsFieldField(OpType) && !newValues.field) {
      newValues.field = "agent_id";
    }
    if (!operationSupportsFieldField(OpType)) {
      delete newValues.field;
    }
    if (operationSupportsComparisonField(OpType) && !newValues.comparison) {
      newValues.comparison = ComparisonTypes.eq;
    }
    if (!operationSupportsComparisonField(OpType)) {
      delete newValues.comparison;
    }
    if (operationSupportsValueField(OpType) && !newValues.value) {
      newValues.value = "50";
    }
    if (!operationSupportsValueField(OpType)) {
      delete newValues.value;
    }
    return newValues;
  };

  return !operation ? null : (
    <>
      <div className="AnalysisModal__RepeatableContentItem AnalysisModal__RepeatableContentItem--type">
        <ModalFormEntryDropdown
          label=""
          options={permittedOperations}
          value={{ label: operation.op, value: operation.op }}
          isSearchable={false}
          onChange={(option) => {
            const newValues = filterPropertiesBasedOnOperationType(
              option.value,
              { ...operation, op: option.value }
            );
            onChange(index, newValues);
          }}
        />
      </div>

      <div
        className={classNames({
          AnalysisModal__RepeatableContentItem: true,
          "AnalysisModal__RepeatableContentItem--metric": true,
          "AnalysisModal__RepeatableContentItem--single":
            operation.op === OperationTypes.get,
        })}
      >
        {operationSupportsFieldField(operation.op) && (
          <ModalFormEntryDropdown
            label=""
            className="AnalysisModal__RepeatableContentItem__FieldDropdown"
            options={behaviorKeysOptions}
            value={[
              {
                value: operation.field,
                label: operation.field,
              } as ReactSelectOption,
            ]}
            isSearchable
            creatable
            creatableIsCaseInsensitive
            onChange={(selectedOption) => {
              const newValues = { ...operation, field: selectedOption.value };
              onChange(index, newValues);
            }}
          />
        )}
      </div>
      <div className="AnalysisModal__RepeatableContentItem AnalysisModal__RepeatableContentItem--comparison">
        {operationSupportsComparisonField(operation.op) &&
          operation.comparison && (
            <ModalFormEntryDropdown
              label=""
              options={comparisonOptions}
              value={[
                { label: operation.comparison, value: operation.comparison },
              ]}
              isSearchable={false}
              onChange={(option) => {
                const newValues = { ...operation, comparison: option.value };
                onChange(index, newValues);
              }}
            />
          )}
      </div>
      <div className="AnalysisModal__RepeatableContentItem AnalysisModal__RepeatableContentItem--value">
        {operationSupportsValueField(operation.op) && (
          <ModalFormEntryRequiredText
            label=""
            errorMessage=""
            placeholder="50"
            name="operationValue"
            value={operation.value}
            onChange={(ev) => {
              let val: boolean | number | string = ev.target.value;
              if (!isNaN(parseInt(val, 10)) || !isNaN(parseFloat(val))) {
                val = Number(val);
              }
              if (val === "true" || val === "True") {
                val = true;
              }
              if (val === "false" || val === "False") {
                val = false;
              }
              onChange(index, { ...operation, value: val });
            }}
          />
        )}
      </div>
      <div
        className="AnalysisModal__RepeatableContentItem__Delete"
        onClick={!hideDelete ? onDelete : () => {}}
      >
        {!hideDelete && <IconTrash size={24} />}
      </div>
    </>
  );
};
