import React, { FC, useEffect } from "react";
import { useModal } from "react-modal-hook";

import { ModalShare } from "../../../Modal/Share/ModalShare";

export const HashCoreHeaderShareButton: FC = () => {
  const [showModal, hideModal] = useModal(
    () => <ModalShare onClose={hideModal} />,
    []
  );

  useEffect(() => {
    return () => {
      hideModal();
    };
  }, [hideModal]);

  return (
    <button
      className="HashCoreHeader__RightButton"
      onClick={async (evt) => {
        evt.preventDefault();
        showModal();
      }}
    >
      Share project
    </button>
  );
};
