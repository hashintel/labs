import React, { FC } from "react";

import { BehaviorKeysFieldFormProps } from "./types";
import { RoundedTextInput } from "../Inputs/RoundedTextInput";

export const BehaviorKeysFieldPopoverOptions: FC<
  Pick<
    BehaviorKeysFieldFormProps,
    "row" | "onRowChange" | "canModifyFields" | "canRemoveField" | "onRemove"
  > & { disabled: boolean; typeDisabled: boolean }
> = ({
  row,
  onRowChange,
  canModifyFields,
  canRemoveField,
  onRemove,
  disabled,
  typeDisabled,
}) => (
  <>
    <label
      className="BehaviorKeys__PopoverSection"
      htmlFor={`${row.uuid}.nullable`}
    >
      Nullable
      <input
        type="checkbox"
        id={`${row.uuid}.nullable`}
        name={`${row.uuid}.nullable`}
        checked={row.meta.nullable}
        onChange={(evt) => {
          const checked = evt.target.checked;
          onRowChange((draft) => {
            draft.meta.nullable = checked;
          });
        }}
        disabled={disabled || typeDisabled}
      />
    </label>
    {row.meta.type === "fixed_size_list" ? (
      <label
        className="BehaviorKeys__PopoverSection"
        htmlFor={`${row.uuid}.length`}
      >
        Length
        <RoundedTextInput
          className="BehaviorKeys__FieldForm__ListLength"
          id={`${row.uuid}.length`}
          name={`${row.uuid}.length`}
          type="number"
          value={row.meta.length}
          min={1}
          disabled={disabled || typeDisabled}
          onChange={(evt) => {
            const value = parseInt(evt.target.value, 10);

            onRowChange((draft) => {
              if (draft.meta.type === "fixed_size_list") {
                draft.meta.length = value;
              }
            });
          }}
        />
      </label>
    ) : null}
    {canModifyFields ? (
      <button
        className="BehaviorKeys__PopoverSection BehaviorKeys__PopoverSection--remove"
        disabled={!canRemoveField || disabled}
        onClick={(evt) => {
          evt.preventDefault();
          onRemove();
        }}
        title={
          canRemoveField
            ? undefined
            : "Behavior keys must contain at least one field"
        }
      >
        Remove Field
      </button>
    ) : null}
  </>
);
