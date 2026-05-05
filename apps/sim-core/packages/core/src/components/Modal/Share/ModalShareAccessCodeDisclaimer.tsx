import React, { FC } from "react";

import { ModalInfoBox } from "../ModalInfoBox";

export const ModalShareAccessCodeDisclaimer: FC<{
  hasAccessCode: boolean;
  name: string;
}> = ({ hasAccessCode, name }) => (
  <ModalInfoBox type="warning" className="ModalShareAccessCodeDisclaimer">
    {hasAccessCode ? `This ${name} contains` : "This will generate"} a token
    which allows this project to be viewed publicly.
  </ModalInfoBox>
);
