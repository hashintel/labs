import React, {
  forwardRef,
  ForwardRefExoticComponent,
  RefAttributes,
  DetailedHTMLProps,
  InputHTMLAttributes,
} from "react";

import { ModalFormEntry, ModalFormEntryProps } from "../ModalFormEntry";

type ModalFormEntryRequiredTextProps = Pick<ModalFormEntryProps, "label"> & {
  errorMessage?: string | undefined;
} & DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>;

export const ModalFormEntryRequiredText: ForwardRefExoticComponent<
  ModalFormEntryRequiredTextProps & RefAttributes<HTMLInputElement>
> = forwardRef<HTMLInputElement, ModalFormEntryRequiredTextProps>(
  ({ label, errorMessage, ...rest }, titleInputRef) => (
    <ModalFormEntry label={label} error={errorMessage}>
      <input type="text" ref={titleInputRef} {...rest} required />
    </ModalFormEntry>
  ),
);
