import React, { FC } from "react";

import { IconTrash } from "../../Icon/Trash";
import {
  ModalFormEntryDropdown,
  ModalFormEntryRequiredText,
} from "../FormEntry";
import { YAxisItemProps } from "../../Analysis/types";

export const YAxisItem: FC<YAxisItemProps> = ({
  item,
  index,
  metricKeysOptions,
  onDelete,
  onChange,
  hideDelete = false,
}) => {
  return !item ? null : (
    <>
      <div className="AnalysisModal__RepeatableContentItem AnalysisModal__RepeatableContentItem--type">
        <ModalFormEntryRequiredText
          label=""
          errorMessage=""
          placeholder="label"
          onChange={(ev) => {
            const newValues = { ...item, name: ev.target.value };
            onChange(index, newValues);
          }}
          value={item.name}
        />
      </div>
      <div className="AnalysisModal__RepeatableContentItem AnalysisModal__RepeatableContentItem--plots-metric">
        <ModalFormEntryDropdown
          label=""
          options={metricKeysOptions}
          value={{ label: item.metric, value: item.metric }}
          isSearchable={true}
          onChange={(option) => {
            onChange(index, { ...item, metric: option.value });
          }}
        />
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
