import React from "react";
import { useModal } from "react-modal-hook";

import { ModalCloudUsage } from "./ModalCloudUsage";

export const useModalCloudUsage = () => {
  const [showModal, hideModal] = useModal(
    () => <ModalCloudUsage onCancel={hideModal} />,
    [],
  );
  return [showModal, hideModal];
};
