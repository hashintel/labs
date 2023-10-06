import React, { FC } from "react";
import classNames from "classnames";

import { Dropdown } from "../../Dropdown";
import { ModalShareSelect } from "./ModalShareSelect";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { ReactSelectOption } from "../../Dropdown/types";
import { TabKind } from "../../../features/viewer/enums";
import { ViewerTab } from "../../../features/viewer/types";

import "./ModalShareViews.scss";

const allViewsOptions = [
  {
    value: "all",
    label: "All Views",
  },
];

export type ModalShareViewsParams = {
  view?: TabKind;
  tabs?: TabKind[] | null;
};

export const ModalShareViews: FC<{
  params: ModalShareViewsParams;
  onParamsChange: (params: ModalShareViewsParams) => void;
  availableTabs: ViewerTab[];
}> = ({ params, onParamsChange, availableTabs }) => {
  const onViewsChange = (options: ReactSelectOption[] | null) => {
    const mappedOptions =
      !options || options.length === 0
        ? allViewsOptions
        : options.length > 1
        ? options.filter((opt) => opt.value !== "all")
        : options;

    const tabs =
      mappedOptions.length === 1 && mappedOptions[0].value === "all"
        ? null
        : mappedOptions.map((option) => option.value as TabKind);

    const view =
      tabs && params.view && !tabs.includes(params.view)
        ? tabs[0]
        : params.view;

    onParamsChange({ ...params, tabs, view });
  };

  const views = params.tabs
    ? params.tabs.map((tab) => ({
        value: tab,
        label:
          availableTabs.find((viewerTab) => viewerTab.kind === tab)?.name ??
          tab,
      }))
    : allViewsOptions;

  return (
    <ModalSplitBottomSection>
      <h4>Default View</h4>
      <ModalShareSelect
        className="ModalShareViews__View"
        value={params.view}
        onChange={(evt) => {
          const view = evt.currentTarget.value as TabKind;
          onParamsChange({ ...params, view });
        }}
        options={availableTabs.map((tab) => ({
          value: tab.kind,
          displayValue: tab.name,
          disabled: !!params.tabs && !params.tabs.includes(tab.kind),
        }))}
      />
      <h4>Views</h4>
      <Dropdown
        className={classNames("ModalShare__MultiSelect", {
          "ModalShare__MultiSelect--nonRemovable": !params.tabs,
        })}
        dark
        isMulti
        options={availableTabs.map((tab) => ({
          label: tab.name,
          value: tab.kind,
        }))}
        value={views}
        onChange={onViewsChange}
      />
    </ModalSplitBottomSection>
  );
};
