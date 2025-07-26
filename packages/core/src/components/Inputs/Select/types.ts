import { DetailedHTMLProps, ReactNode, SelectHTMLAttributes } from "react";

export type SelectProps = Omit<
  DetailedHTMLProps<SelectHTMLAttributes<HTMLSelectElement>, HTMLSelectElement>,
  "onFocus" | "onBlur" | "value" | "prefix" | "ref"
> & {
  focused?: boolean;
  onFocusedChange?: (focused: boolean) => void;
  options: {
    selectedDisplayValue?: ReactNode;
    displayValue?: string;
    value: string;
    disabled?: boolean;
  }[];
  value?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
};
