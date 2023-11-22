import { SelectComponents } from "react-select/src/components";

export interface ReactSelectOption {
  label: string;
  subLabel?: string;
  value: string;
}

export interface DropdownProps {
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
}
