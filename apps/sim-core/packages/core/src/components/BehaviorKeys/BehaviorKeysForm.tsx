import React, { FC, useEffect, useRef, useState } from "react";
import { batch, useDispatch, useSelector } from "react-redux";
import produce, { Draft } from "immer";

import {
  BehaviorKeysDraftField,
  BehaviorKeysDraftFieldWithRows,
  BehaviorKeysDraftRow,
  calculateRowClashes,
} from "../../features/files/behaviorKeys";
import { BehaviorKeysFieldForm } from "./BehaviorKeysFieldForm";
import { BehaviorKeysRow } from "./BehaviorKeysRow";
import { CheckboxInput } from "../Inputs/Checkbox/CheckboxInput";
import { FancyButton } from "../Fancy/Button";
import { FancyButtonAsyncTask } from "../Fancy/Button/FancyButtonAsyncTask";
import { IconHelpCircle } from "../Icon";
import { Projection } from "./types";
import { ScrollFadeShadow } from "../ScrollFade/ScrollFadeShadow";
import { SimpleTooltip } from "../SimpleTooltip";
import { addField } from "./utils";
import {
  parseAndShowBehaviorKeys,
  updateBehaviorKeysDynamicAccess,
} from "../../features/files/slice";
import {
  selectBehaviorKeysDynamicAccess,
  selectSharedBehaviorKeyFieldNames,
} from "../../features/files/selectors";
import { useAbortingDispatch } from "../../hooks/useAbortingDispatch";
import { useScrollState } from "../../hooks/useScrollState";

import "./BehaviorKeysForm.scss";

const scrollToEnd = (scrollable: HTMLUListElement | null) => {
  if (scrollable) {
    scrollable.scrollTop = scrollable.scrollHeight;
  }
};

export const BehaviorKeysForm: FC<{
  data: BehaviorKeysDraftFieldWithRows;
  onDataChange: (rows: BehaviorKeysDraftRow[]) => void;
  onProjectionChange: (idx: number) => void;
  projection: Projection;
  fileId: string;
  autosuggest: boolean;
  disabled: boolean;
}> = ({
  data: originalData,
  onDataChange,
  onProjectionChange,
  projection,
  fileId,
  autosuggest,
  disabled,
}) => {
  const [draftData, setDraftData] = useState<null | {
    current: BehaviorKeysDraftFieldWithRows;
    draft: BehaviorKeysDraftFieldWithRows;
  }>(null);

  if (draftData && draftData.current !== originalData) {
    setDraftData(null);
  }

  const data = draftData?.draft ?? originalData;

  const onDataChangeRef = useRef(onDataChange);
  const clashes = calculateRowClashes(data.rows);
  const dispatch = useDispatch();
  const dynamicAccess = useSelector(selectBehaviorKeysDynamicAccess);

  const sharedBehaviorKeyNames = useSelector(selectSharedBehaviorKeyFieldNames);
  const lockedNames = projection.length === 0 ? sharedBehaviorKeyNames : [];
  const formDisabled =
    projection.length === 0
      ? false
      : sharedBehaviorKeyNames.includes(projection[0].label);

  const displayWarning =
    !disabled &&
    (formDisabled ||
      data.rows
        .map((row) => row[0])
        .some((name) => lockedNames.includes(name)));

  useEffect(() => {
    onDataChangeRef.current = onDataChange;
  });

  const setData = (handler: (draft: Draft<BehaviorKeysDraftRow[]>) => void) => {
    onDataChangeRef.current(produce(data.rows, handler));
  };

  const canModifyFields = data.key === "fields";
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollStateRef, contentRemaining] = useScrollState();

  const [
    dispatchParseAndShowBehaviorKeys,
    isParsingDisabled,
  ] = useAbortingDispatch(parseAndShowBehaviorKeys, [autosuggest]);

  const focusLast = () => {
    const fields =
      listRef.current?.querySelectorAll<HTMLInputElement>("input[type=text]") ??
      [];
    const last = fields[fields.length - 1];
    if (last) {
      last.focus();
      last.select();
    }
  };

  const onAddField = () => {
    setData((draft) => addField(draft, projection.length === 0));
    Promise.resolve().then(() => {
      if (listRef.current) {
        scrollToEnd(listRef.current);
        focusLast();
      }
    });
  };

  return (
    <>
      <div className="BehaviorKeys__FormWrapper">
        {disabled && !dynamicAccess ? null : (
          <div className="BehaviorKeys__DynamicAccessCheckbox">
            <label htmlFor="dynamicAccessCheckbox">
              <CheckboxInput
                checked={dynamicAccess}
                disabled={disabled}
                id="dynamicAccessCheckbox"
                onChange={(evt) => {
                  dispatch(
                    updateBehaviorKeysDynamicAccess({
                      fileId,
                      dynamicAccess: evt.target.checked,
                    })
                  );
                }}
              />
              Access all fields defined in other behaviors
              <a
                href="https://docs.hash.ai/core/creating-simulations/behaviors/behavior-keys"
                target="_blank"
                rel="noreferrer noopener"
              >
                <IconHelpCircle size={18} />
                <SimpleTooltip position="below" allRoundedBorders>
                  <h4>VIEW DOCS</h4>
                  <p>
                    If this behavior needs to use fields defined in other
                    behaviors and you don’t know which ones, check this. If you
                    do know their names, type them below and they will be synced
                    automatically.
                  </p>
                </SimpleTooltip>
              </a>
            </label>
          </div>
        )}
        {disabled ? (
          <p className="BehaviorKeys__ReadOnlyWarning BehaviorKeys__ReadOnlyWarning--disabled">
            Fields in this behavior cannot be modified. Check that you are on
            the "main" version of the project, and that you are editing this
            behavior in its original context.
          </p>
        ) : displayWarning ? (
          <p className="BehaviorKeys__ReadOnlyWarning">
            Some fields in this behavior cannot be modified because they're also
            defined in an imported behavior
          </p>
        ) : null}
        <ul
          className="BehaviorKeys__Form"
          ref={(ref) => {
            listRef.current = ref;
            scrollStateRef(ref);
          }}
        >
          {data.rows.map(([fieldName, row], idx) => {
            const clash = clashes[idx];
            const realRow = originalData.rows.find(
              (originalRow) => originalRow[1].uuid === row.uuid
            );

            const onChange = (
              handler: (
                draft: Draft<BehaviorKeysDraftRow>
              ) => void | BehaviorKeysDraftRow
            ) => {
              setData((draft) => {
                const next = handler(draft[idx]);
                draft[idx] = typeof next === "undefined" ? draft[idx] : next;
              });
            };

            const onRowChange = (
              handler: (
                draft: Draft<BehaviorKeysDraftField>
              ) => void | BehaviorKeysDraftField
            ) => {
              onChange((draft) => {
                const next = handler(draft[1]);

                draft[1] = typeof next === "undefined" ? draft[1] : next;
              });
            };

            const onProject = () => onProjectionChange(idx);

            const onRemove = () => {
              setData((draft) => {
                draft.splice(idx, 1);
              });
            };

            return (
              <BehaviorKeysFieldForm
                key={row.uuid}
                fieldName={fieldName}
                row={row}
                emptyName={
                  !fieldName.trim().length &&
                  !!realRow &&
                  !realRow[0].trim().length
                }
                clash={clash}
                projection={projection}
                onRowChange={onRowChange}
                onProject={onProject}
                onRemove={onRemove}
                onAddField={onAddField}
                canModifyFields={canModifyFields}
                canRemoveField={!projection.length || data.rows.length > 1}
                onNameChange={(newName) => {
                  const nextData = produce(data, (draft) => {
                    draft.rows[idx][0] = newName;
                  });

                  setDraftData({ current: originalData, draft: nextData });
                }}
                onNameCommit={() => {
                  if (draftData) {
                    batch(() => {
                      onDataChangeRef.current(draftData.draft.rows);
                      setDraftData(null);
                    });
                  }
                }}
                disabled={disabled || formDisabled}
                typeDisabled={disabled || lockedNames.includes(fieldName)}
              />
            );
          })}
        </ul>
        <ScrollFadeShadow visible={contentRemaining} />
      </div>
      {canModifyFields && !formDisabled && !disabled ? (
        <BehaviorKeysRow as="div" className="BehaviorKeys__Form__Buttons">
          <FancyButton
            onClick={(evt) => {
              evt.preventDefault();
              onAddField();
            }}
            icon="keyPlus"
            theme="blue"
            className="BehaviorKeys__Form__Buttons__Button"
          >
            Add new key
          </FancyButton>
          {autosuggest ? (
            <FancyButtonAsyncTask
              onTaskBegin={async () => {
                await dispatchParseAndShowBehaviorKeys({ fileId });
              }}
              icon="autoFix"
              theme="dark"
              className="BehaviorKeys__Form__Buttons__Button"
              disabled={isParsingDisabled}
            >
              Autosuggest keys
            </FancyButtonAsyncTask>
          ) : null}
        </BehaviorKeysRow>
      ) : null}
    </>
  );
};
