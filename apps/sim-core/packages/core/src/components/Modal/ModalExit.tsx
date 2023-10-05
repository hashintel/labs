import React, { FC } from "react";

import { IconClose } from "../Icon";

import "./ModalExit.scss";

export const ModalExit: FC<{ onClose: VoidFunction }> = ({ onClose }) => (
  <button
    onClick={(evt) => {
      evt.preventDefault();
      onClose();
    }}
    className="ModalExit"
  >
    Esc <IconClose size={10} />
  </button>
);
