import React, { FC } from "react";

import { Dropdown } from "../../../Dropdown";
import type { DropdownProps } from "../../../Dropdown/types";
import { ModalFormEntry, ModalFormEntryProps } from "../ModalFormEntry";

type ModalFormEntryDropdownProps = Pick<
  ModalFormEntryProps,
  "label" | "optional" | "className"
> &
  Pick<
    DropdownProps,
    | "options"
    | "value"
    | "required"
    | "onChange"
    | "isSearchable"
    | "name"
    | "placeholder"
    | "isMulti"
    | "isClearable"
    | "creatable"
    | "components"
    | "menuIsOpen" // useful for debugging
    | "isDisabled"
  > & { creatableIsCaseInsensitive?: boolean };

export const ModalFormEntryDropdown: FC<ModalFormEntryDropdownProps> = ({
  label,
  optional,
  options,
  ...rest
}) => (
  <ModalFormEntry label={label} optional={optional}>
    <Dropdown
      options={options}
      largeList={options.length > 200}
      dark
      {...rest}
    />
  </ModalFormEntry>
);
