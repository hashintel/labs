import React, { FC } from "react";

import { BigModal } from "../..";
import { FancyButton } from "../../../Fancy";
import { useModalConfirm } from "../hooks";

import "./ModalConfirmFileDelete.css";

type ModalConfirmFileDeleteProps = {
  onAnswer: (answer: boolean) => void;
  fileName: string;
};

export const ModalConfirmFileDelete: FC<ModalConfirmFileDeleteProps> = ({
  onAnswer,
  fileName,
}) => {
  useModalConfirm(onAnswer);

  return (
    <BigModal
      onClose={() => onAnswer(false)}
      className="ModalConfirmFileDelete"
    >
      <h2 className="ModalConfirmFileDelete__title">
        Are you sure you want to delete <strong>{fileName}</strong>?
      </h2>
      <p className="ModalConfirmFileDelete__detail">
        Removing <strong>{fileName}</strong> from your simulation cannot be
        undone.
      </p>
      <div className="ModalConfirmFileDelete__buttons">
        <FancyButton onClick={() => onAnswer(true)} icon="trash">
          <strong className="ModalConfirmFileDelete__buttons__label">
            CONFIRM DELETION
          </strong>
        </FancyButton>
        <FancyButton
          onClick={() => onAnswer(false)}
          icon="cancel"
          theme="black"
        >
          <strong className="ModalConfirmFileDelete__buttons__label">
            CANCEL
          </strong>
        </FancyButton>
      </div>
    </BigModal>
  );
};
