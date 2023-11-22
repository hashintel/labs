#!/usr/bin/env ts-node

/// <reference types="../types" />

import { basename } from "path";

import { generateFiles } from "./utils/generateFiles";
import { parseArgs, validateIcon } from "./utils";

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

export function cli() {
  const { dryRun, verbose, fromIcon, _ } = parseArgs();

  // TODO: @mysterycommand - is there a way to make `yargs` do the validation?
  const isValidIcon = isString(fromIcon) && validateIcon(fromIcon);

  if (isValidIcon && _.length > 1) {
    throw new Error(
      `Can't use \`--fromIcon\` while generating multiple components, got ${_.map(
        (arg) => `"${arg}"`,
      ).join(", ")} with \`--fromIcon "${fromIcon}"\``,
    );
  }

  // if we passed in `--fromIcon` and no component name, use the svg's basename
  // n.b. `fromIcon!` is fine(?) below, because `isValidIcon` checks for string
  // value, `.svg` extension, and file existence
  const names =
    isValidIcon && _.length === 0 ? [basename(fromIcon, ".svg")] : _;

  names.forEach(generateFiles({ dryRun, verbose, isValidIcon, fromIcon }));
}

cli();
