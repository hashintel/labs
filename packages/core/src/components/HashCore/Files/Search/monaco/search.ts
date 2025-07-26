// Adapted from https://github.com/microsoft/vscode/blob/a1de2a783afd8c9e64d3ddbf517df727f9f6cdef/src/vs/base/common/search.ts

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { containsUppercaseCharacter } from "./strings";

export function buildReplaceStringWithCasePreserved(
  matches: string[] | null,
  pattern: string,
): string {
  if (matches && matches[0] !== "") {
    const containsHyphens = validateSpecificSpecialCharacter(
      matches,
      pattern,
      "-",
    );
    const containsUnderscores = validateSpecificSpecialCharacter(
      matches,
      pattern,
      "_",
    );
    if (containsHyphens && !containsUnderscores) {
      return buildReplaceStringForSpecificSpecialCharacter(
        matches,
        pattern,
        "-",
      );
    } else if (!containsHyphens && containsUnderscores) {
      return buildReplaceStringForSpecificSpecialCharacter(
        matches,
        pattern,
        "_",
      );
    }
    if (matches[0].toUpperCase() === matches[0]) {
      return pattern.toUpperCase();
    } else if (matches[0].toLowerCase() === matches[0]) {
      return pattern.toLowerCase();
    } else if (containsUppercaseCharacter(matches[0][0])) {
      return pattern[0].toUpperCase() + pattern.substr(1);
    } else {
      // we don't understand its pattern yet.
      return pattern;
    }
  } else {
    return pattern;
  }
}

function validateSpecificSpecialCharacter(
  matches: string[],
  pattern: string,
  specialCharacter: string,
): boolean {
  const doesContainSpecialCharacter =
    matches[0].indexOf(specialCharacter) !== -1 &&
    pattern.indexOf(specialCharacter) !== -1;
  return (
    doesContainSpecialCharacter &&
    matches[0].split(specialCharacter).length ===
      pattern.split(specialCharacter).length
  );
}

function buildReplaceStringForSpecificSpecialCharacter(
  matches: string[],
  pattern: string,
  specialCharacter: string,
): string {
  const splitPatternAtSpecialCharacter = pattern.split(specialCharacter);
  const splitMatchAtSpecialCharacter = matches[0].split(specialCharacter);
  let replaceString = "";
  splitPatternAtSpecialCharacter.forEach((splitValue, index) => {
    replaceString +=
      buildReplaceStringWithCasePreserved(
        [splitMatchAtSpecialCharacter[index]],
        splitValue,
      ) + specialCharacter;
  });

  return replaceString.slice(0, -1);
}
