import { existsSync } from "fs";
import { extname } from "path";

export function validateIcon(iconPath: string): boolean {
  const isSvg = extname(iconPath) === ".svg";
  const isFile = existsSync(iconPath);
  const isValidIcon = isSvg && isFile;

  if (iconPath && !isValidIcon) {
    throw new Error(
      `Got \`--fromIcon "${iconPath}"\`, but ${[
        ...(isSvg ? [] : ["it's missing the `.svg` extension"]),
        ...(isFile ? [] : ["there's no file at that location"]),
      ].join(", and ")}`
    );
  }

  return isValidIcon;
}
