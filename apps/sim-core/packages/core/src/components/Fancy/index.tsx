import React, { ReactChild, CSSProperties, MouseEvent } from "react";

import {
  IconArrowLeftBold,
  IconArrowRightBold,
  IconCancel,
  IconCopy,
  IconDesktop,
  IconEye,
  IconFileFind,
  IconFolder,
  IconHCoreMono,
  IconHIndex,
  IconImport,
  IconOpenInNew,
  IconPencil,
  IconPlus,
  IconRunFast,
  IconServer,
  IconSparkles,
  IconTrash,
} from "../Icon";
import { IconAutoFix } from "../Icon/AutoFix/IconAutoFix";
import { IconDirectionsFork } from "../Icon/DirectionsFork";
import { IconKeyPlus } from "../Icon/KeyPlus/IconKeyPlus";

import "./Fancy.scss";

export type FancyTheme =
  | "black"
  | "grey"
  | "white"
  | "blue"
  | "dark"
  | "transparent";
export type FancyIcon =
  | "arrowLeftBold"
  | "arrowRightBold"
  | "autoFix"
  | "cancel"
  | "copy"
  | "desktop"
  | "eye"
  | "fileFind"
  | "folder"
  | "fork"
  | "hCoreMono"
  | "hindex"
  | "import"
  | "keyPlus"
  | "openInNew"
  | "pencil"
  | "plus"
  | "runFast"
  | "server"
  | "sparkles"
  | "trash";

export type FancySize = "regular" | "compact";

export type FancyProps<T> = {
  theme?: FancyTheme;
  icon?: FancyIcon;
  size?: FancySize;
  style?: Omit<CSSProperties, "height" | "paddingLeft" | "paddingRight">;
  onClick?: (event: MouseEvent<T>) => void;
  target?: string;
  className?: string;
};

export function getIcon(icon: FancyIcon, size: FancySize): ReactChild {
  return (
    <span className="Fancy-icon">
      {
        {
          arrowLeftBold: <IconArrowLeftBold />,
          arrowRightBold: <IconArrowRightBold />,
          autoFix: <IconAutoFix size={24} />,
          cancel: <IconCancel />,
          copy: <IconCopy size={size === "compact" ? 16 : undefined} />,
          desktop: <IconDesktop />,
          eye: <IconEye />,
          fileFind: <IconFileFind size={size === "compact" ? 18 : undefined} />,
          folder: <IconFolder size={size === "compact" ? 16 : undefined} />,
          fork: (
            <IconDirectionsFork size={size === "compact" ? 16 : undefined} />
          ),
          hCoreMono: <IconHCoreMono size={26} />,
          hindex: <IconHIndex size={12} />,
          import: <IconImport />,
          keyPlus: <IconKeyPlus size={24} />,
          openInNew: <IconOpenInNew />,
          pencil: <IconPencil size={size === "compact" ? 16 : undefined} />,
          plus: <IconPlus />,
          runFast: <IconRunFast />,
          server: <IconServer />,
          sparkles: <IconSparkles size={size === "compact" ? 16 : undefined} />,
          trash: <IconTrash size={24} />,
        }[icon]
      }
    </span>
  );
}

export { FancyAnchor } from "./Anchor";
export { FancyButton } from "./Button";
