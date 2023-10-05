import React, { FC, useState, useEffect } from "react";
import Creatable from "react-select/creatable";
import Select, { createFilter } from "react-select";
import classNames from "classnames";

import { DropdownMenuList } from "./MenuList";
import type { DropdownProps, ReactSelectOption } from "./types";
import { IconMenuDown } from "../Icon";

import "./Dropdown.scss";

const caseInsensitiveIsValidNewOption = (
  inputValue: string,
  _selectValue: ReactSelectOption[],
  selectOptions: ReactSelectOption[]
) => {
  const exactValueExists = selectOptions.find((el) => el.value === inputValue);
  // Without this, it will show create option for empty values.
  const valueIsNotEmpty = inputValue.trim().length;
  return !exactValueExists && valueIsNotEmpty;
};

/**
 * n.b. this is *mostly* copy/pasted from the `hashintel/hash.ai` repo,
 * specifically the below-linked component and styles
 *
 * @see: https://github.com/hashintel/hash.ai/blob/master/nextjs/src/components/Dropdown.tsx
 * @see: https://github.com/hashintel/hash.ai/blob/master/nextjs/src/styles/scss/components/_ReactSelect.scss
 */

export const Dropdown: FC<DropdownProps> = ({
  options,
  value,
  onChange,
  onBlur,
  isSearchable = true,
  isClearable = false,
  isMulti,
  isOptionDisabled,
  name,
  noOptionsMessage,
  creatable,
  placeholder,
  id,
  dark,
  required,
  isDisabled,
  menuIsOpen,
  components,
  largeList = false,
  className = "",
  creatableIsCaseInsensitive = false,
}) => {
  const [liveOptions, setOptions] = useState(options);

  useEffect(() => {
    setOptions(options);
  }, [options]);

  // this will prioritise matches which begin with the search string.
  // the default behaviour we are overriding is to sort alphabetically.
  const handleSearchInput = (inputValue: string, { action }: any) => {
    if (action === "input-change") {
      let foundOptions = options.filter((option) =>
        option.label.toLowerCase().includes(inputValue.toLowerCase())
      );
      if (inputValue !== "") {
        foundOptions = foundOptions.sort((a, b) => {
          if (a.label.toLowerCase() === inputValue.toLowerCase()) {
            return -1;
          } else if (b.label.toLowerCase() === inputValue.toLowerCase()) {
            return 1;
          } else if (
            a.label.toLowerCase().startsWith(inputValue.toLowerCase())
          ) {
            return -1;
          } else if (
            b.label.toLowerCase().startsWith(inputValue.toLowerCase())
          ) {
            return 1;
          } else {
            return a.label.localeCompare(b.label);
          }
        });
      }
      setOptions(foundOptions);
    } else if (action === "menu-close") {
      setOptions(options);
    }
  };

  const props: any = {
    options: liveOptions,
    value,
    onChange: (option: ReactSelectOption) => {
      onChange(option);
      setOptions(options);
    },
    onBlur,
    components: {
      DropdownIndicator: IconMenuDown,
      ...components,
      ...(largeList ? { MenuList: DropdownMenuList } : {}),
    },
    isMulti,
    isClearable,
    isSearchable,
    isOptionDisabled,
    name,
    noOptionsMessage: () => noOptionsMessage,
    placeholder,
    classNamePrefix: "react-select",
    className: classNames("react-select-container", className, { dark }),
    inputId: id,
    isDisabled,
    menuIsOpen,
  };
  if (creatableIsCaseInsensitive) {
    props.filterOption = createFilter({ ignoreCase: false });
    props.isValidNewOption = caseInsensitiveIsValidNewOption;
  }

  // only bother to override filtering behaviour if we are allowing filtering
  if (isSearchable) {
    props.onInputChange = handleSearchInput;
    props.filterOption = () => true;
  }

  return (
    <div className="dropdown-wrapper">
      {creatable ? <Creatable {...props} /> : <Select {...props} />}
      {required && (
        <input
          tabIndex={-1}
          value={props.value || ""}
          onChange={() => null}
          autoComplete="off"
          className={classNames("required-input-enforcement", className)}
          required
        />
      )}
    </div>
  );
};
