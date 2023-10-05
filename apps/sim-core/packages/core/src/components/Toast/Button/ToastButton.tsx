import React, { FC } from "react";

import { FancyButton, FancyProps } from "../../Fancy";

type ToastButtonProps = Pick<FancyProps<HTMLButtonElement>, "onClick" | "icon">;

export const ToastButton: FC<ToastButtonProps> = ({
  children,
  onClick,
  icon,
}) => (
  <FancyButton icon={icon} size="compact" theme="grey" onClick={onClick}>
    <strong>{children}</strong>
  </FancyButton>
);
