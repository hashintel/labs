import React, { FC } from "react";

import { Dropdown } from "../../../Dropdown";
import { FancyButton } from "../../../Fancy";
import type { ReactSelectOption } from "../../../Dropdown/types";

import "./ModalFormEntryPublishAs.css";

interface ModalFormEntryPublishAsProps {
  buttonLabel: string;
  publishAsOptions: ReactSelectOption[];
  selectedPublishAs: ReactSelectOption;
  setSelectedPublishAs: (publishAs: ReactSelectOption) => void;
  disabled?: boolean;
  submitDisabled?: boolean;
}

export const ModalFormEntryPublishAs: FC<ModalFormEntryPublishAsProps> = ({
  buttonLabel,
  publishAsOptions,
  selectedPublishAs,
  setSelectedPublishAs,
  disabled = false,
  submitDisabled = false,
}) => (
  <div className="ModalFormEntryPublishAs">
    <FancyButton
      icon="hindex"
      theme="white"
      type="submit"
      disabled={submitDisabled || disabled}
    >
      <strong>{buttonLabel}</strong>
    </FancyButton>
    <span className="ModalFormEntryPublishAs__spacer">as</span>
    {publishAsOptions.length > 1 ? (
      <Dropdown
        value={selectedPublishAs}
        options={publishAsOptions}
        onChange={setSelectedPublishAs}
        placeholder="Select a publisher"
        isClearable={false}
        isSearchable={false}
        isDisabled={disabled}
        dark
      />
    ) : (
      <span>{selectedPublishAs?.label}</span>
    )}
  </div>
);
