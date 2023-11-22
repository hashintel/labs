import React, { FC, useState } from "react";
import { batch } from "react-redux";
import classNames from "classnames";
import { debounce } from "lodash";

import {
  BehaviorKeysField,
  fieldHasRows,
} from "../../features/files/behaviorKeys";
import { BehaviorKeysFieldFormProps } from "./types";
import { BehaviorKeysFieldPopover } from "./BehaviorKeysFieldPopover";
import { BehaviorKeysFieldPopoverOptions } from "./BehaviorKeysFieldFormPopoverOptions";
import { BehaviorKeysRow } from "./BehaviorKeysRow";
import { IconAlert } from "../Icon/Alert";
import { IconMore } from "../Icon/More";
import { IconTree } from "../Icon/Tree";
import { RoundedSelect } from "../Inputs/Select/RoundedSelect";
import { RoundedTextInput } from "../Inputs/RoundedTextInput";
import { behaviorKeysRowTypes } from "../../features/files/utils";
import { castField } from "./utils";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { validateBehaviorKeyName } from "../../features/files/validate";
import { validateClash } from "./validate";

import "./BehaviorKeysFieldForm.scss";

export const BehaviorKeysFieldForm: FC<BehaviorKeysFieldFormProps> = ({
  fieldName,
  row,
  clash,
  projection,
  onRowChange,
  onProject,
  onRemove,
  canModifyFields,
  canRemoveField,
  onAddField,
  onNameChange,
  onNameCommit,
  typeDisabled,
  disabled,
  emptyName,
}) => {
  const rootField = !projection.length;
  const trimmedFieldName = fieldName.trim();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isErrorOpen, setIsErrorOpen] = useState(false);

  const clashError = validateClash(clash);
  const errors = [
    ...validateBehaviorKeyName(trimmedFieldName, rootField),
    ...(clashError ? [clashError] : []),
    ...(emptyName ? ["Your field must have a name"] : []),
  ];

  useKeyboardShortcuts(
    isOptionsOpen
      ? {
          single: {
            Escape() {
              setIsOptionsOpen(false);
            },
          },
        }
      : {},
  );

  const debouncedOnAdd = debounce(onAddField);

  return (
    <BehaviorKeysRow as="li" className="BehaviorKeys__FieldForm">
      <div className="BehaviorKeys__FieldForm__Container">
        {canModifyFields ? (
          <RoundedTextInput
            name={`${row.uuid}.field`}
            value={fieldName}
            onChange={(evt) => {
              const value = evt.target.value;
              batch(() => {
                setIsErrorOpen(false);
                onNameChange(value);
              });
            }}
            onBlur={() => {
              onNameCommit();
            }}
            onKeyDown={(evt) => {
              if (evt.key === "Enter") {
                debouncedOnAdd();
              }
            }}
            placeholder="Field Name"
            className="BehaviorKeys__FieldForm__FieldName"
            disabled={disabled}
          />
        ) : null}
        <RoundedSelect
          name={`${row.uuid}.type`}
          className="BehaviorKeys__FieldForm__Type"
          options={behaviorKeysRowTypes.flatMap((type) =>
            type === "any" && projection.length > 0 ? [] : [{ value: type }],
          )}
          value={row.meta.type}
          onChange={(evt) => {
            const value = evt.target.value as BehaviorKeysField["type"];

            onRowChange((draft) => castField(draft, value));
          }}
          disabled={disabled || typeDisabled}
        />
        {errors.length ? (
          <BehaviorKeysFieldPopover
            isOpen={isErrorOpen}
            type="error"
            content={errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          >
            <div
              onMouseOver={() => setIsErrorOpen(true)}
              onMouseOut={() => setIsErrorOpen(false)}
              className="BehaviorKeys__FieldForm__Button BehaviorKeys__FieldForm__Button--error"
            >
              <IconAlert size={18} />
            </div>
          </BehaviorKeysFieldPopover>
        ) : null}
        {fieldHasRows(row) ? (
          <button
            className={classNames(
              "BehaviorKeys__FieldForm__Button BehaviorKeys__FieldForm__Button--children",
            )}
            onClick={() => {
              onProject();
            }}
          >
            <IconTree size={16} />
          </button>
        ) : null}
        <BehaviorKeysFieldPopover
          isOpen={isOptionsOpen}
          onClickOutside={() => setIsOptionsOpen(false)}
          content={
            <BehaviorKeysFieldPopoverOptions
              row={row}
              onRowChange={onRowChange}
              canModifyFields={canModifyFields}
              canRemoveField={canRemoveField}
              onRemove={onRemove}
              disabled={disabled}
              typeDisabled={typeDisabled}
            />
          }
        >
          <button
            className={classNames(
              "BehaviorKeys__FieldForm__Button BehaviorKeys__FieldForm__Button--options",
              {
                "BehaviorKeys__FieldForm__Button--options--open": isOptionsOpen,
              },
            )}
            onClick={() => setIsOptionsOpen(!isOptionsOpen)}
          >
            <IconMore size={12} />
          </button>
        </BehaviorKeysFieldPopover>
      </div>
    </BehaviorKeysRow>
  );
};
