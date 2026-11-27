import { SelectComponents } from "react-select/src/components";

export type ReactSelectOption = {
  label: string;
  subLabel?: string;
  value: string;
};

export type DropdownProps = {
  options: ReactSelectOption[];
  value: ReactSelectOption | ReactSelectOption[] | undefined;
  onChange: (option: any) => void;
  onBlur?: () => void;
  isSearchable?: boolean;
  isClearable?: boolean;
  isMulti?: boolean;
  isOptionDisabled?: (option: ReactSelectOption) => boolean;
  name?: string;
  noOptionsMessage?: string;
  creatable?: boolean;
  placeholder?: string;
  id?: string;
  dark?: boolean;
  required?: boolean;
  isDisabled?: boolean;
  menuIsOpen?: boolean;
  components?: Partial<Pick<SelectComponents<ReactSelectOption>, "Option">>;
  largeList?: boolean;
  className?: string;
  creatableIsCaseInsensitive?: boolean;
};
