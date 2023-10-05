import React, { FC } from "react";
import classNames from "classnames";

import { IconClose } from "../../Icon/Close";
import { Modal, ModalProps } from "../Modal";

import "./ModalFullScreen.css";

export const ModalFullScreen: FC<ModalProps & { theme?: "light" | "dark" }> = ({
  backdropClassName,
  modalClassName,
  children,
  onClose,
  theme = "dark",
  ...props
}) => (
  <Modal
    {...props}
    onClose={onClose}
    backdropClassName={classNames(
      backdropClassName,
      `ModalFullScreen-backdrop--${theme}`
    )}
    modalClassName={classNames(
      "ModalFullScreen",
      `ModalFullScreen--${theme}`,
      modalClassName
    )}
    backdropExit={false}
  >
    <div className="ModalFullScreen__Close" onClick={onClose}>
      <IconClose size={16} />
    </div>
    {children}
  </Modal>
);
