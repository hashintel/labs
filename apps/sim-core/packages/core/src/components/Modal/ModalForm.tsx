import React, { FC } from "react";

import "./ModalForm.scss";

export const ModalForm: FC<{
  onSubmit: () => Promise<void>;
  disabled: boolean | undefined;
}> = ({ onSubmit, disabled, children }) => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
    }}
  >
    <fieldset disabled={disabled} className="ModalForm__Fieldset">
      {children}
    </fieldset>
  </form>
);
