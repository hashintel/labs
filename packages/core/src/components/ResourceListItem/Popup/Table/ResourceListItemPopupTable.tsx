import React, { FC } from "react";

import { CheckboxInput } from "../../../Inputs/Checkbox/CheckboxInput";
import {
  HcDependencyFile,
  HcSharedDatasetFile,
} from "../../../../features/files/types";
import { HcFileKind } from "../../../../features/files/enums";
import { ResourceProject } from "../../../../features/project/types";

import "./ResourceListItemPopupTable.css";

const isDatasetFile = (file: HcDependencyFile): file is HcSharedDatasetFile =>
  file.kind === HcFileKind.Dataset;

/**
 * @todo this should support multiple behaviors too
 */
export const ResourceListItemPopupTable: FC<{
  deselectedItems: string[];
  onDeselectAllItems: () => void;
  onDeselectItem: (itemId: string) => void;
  onSelectAllItems: () => void;
  onSelectItem: (itemId: string) => void;
  presentItems: string[];
  resource: ResourceProject;
  selectableItemsCount: number;
}> = ({
  deselectedItems,
  onDeselectAllItems,
  onDeselectItem,
  onSelectAllItems,
  onSelectItem,
  presentItems,
  resource,
  selectableItemsCount,
}) => (
  <div className="ResourceListItemPopupTable-container">
    <table className="ResourceListItemPopupTable">
      <thead>
        <tr>
          <th>
            <CheckboxInput
              checked={deselectedItems.length === 0}
              onChange={(evt) => {
                if (evt.target.checked) {
                  onSelectAllItems();
                } else {
                  onDeselectAllItems();
                }
              }}
              disabled={selectableItemsCount === 0}
            />
          </th>
          <th>Files to add</th>
        </tr>
      </thead>
      <tbody>
        {resource.files.map((file) => {
          const name = `checkbox-${file.path.formatted}`;

          return (
            <tr key={file.path.formatted}>
              <td>
                <CheckboxInput
                  checked={!deselectedItems.includes(file.path.formatted)}
                  disabled={presentItems.includes(file.path.formatted)}
                  onChange={(evt) => {
                    if (evt.target.checked) {
                      onSelectItem(file.path.formatted);
                    } else {
                      onDeselectItem(file.path.formatted);
                    }
                  }}
                  name={name}
                  id={name}
                />
              </td>
              <td>
                <label htmlFor={name}>
                  {isDatasetFile(file) ? (
                    <>
                      <span className="ResourceListItemPopupTable__resource-name">
                        {file.data.name}
                      </span>
                      &nbsp;&nbsp;
                    </>
                  ) : null}
                  <span className="ResourceListItemPopupTable__short-name">
                    {file.path.base}
                  </span>
                </label>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
