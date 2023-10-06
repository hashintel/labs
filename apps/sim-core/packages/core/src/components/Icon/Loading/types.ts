import { IconProps } from "../index";

export type IconLoadingProps = Omit<IconProps, "size"> & {
  start?: string;
  end: string;
};
