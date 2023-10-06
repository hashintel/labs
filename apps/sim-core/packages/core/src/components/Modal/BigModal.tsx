import React, { FC } from "react";
import classNames from "classnames";

import { Modal } from "./Modal";
import { ModalExit } from "./ModalExit";

import "./BigModal.css";

type BigModalProps = {
  onClose?: () => void;
  cancelButton?: boolean;
  className?: string;
  backdropClassName?: string;
};

export const BigModal: FC<BigModalProps> = ({
  onClose,
  cancelButton = true,
  children,
  className,
  backdropClassName,
}) => (
  <Modal
    modalClassName={classNames("BigModal", className)}
    backdropClassName={backdropClassName}
    onClose={onClose}
    containerClassName="BigModal-Container"
  >
    {onClose && cancelButton && <ModalExit onClose={onClose} />}
    {children}
  </Modal>
);
