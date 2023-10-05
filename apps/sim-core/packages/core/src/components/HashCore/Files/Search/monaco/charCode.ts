// Adapted from https://github.com/microsoft/vscode/blob/a1de2a783afd8c9e64d3ddbf517df727f9f6cdef/src/vs/base/common/charCode.ts
// To keep the bundle size small, this is just a subset needed for our purposes

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Names from https://blog.codinghorror.com/ascii-pronunciation-rules-for-programmers/

/**
 * An inlined enum containing useful character codes (to be used with String.charCodeAt).
 */
export enum CharCode {
  /**
   * The `$` character.
   */
  DollarSign = 36,
  /**
   * The `&` character.
   */
  Ampersand = 38,

  Digit0 = 48,
  Digit1 = 49,
  Digit9 = 57,

  L = 76,
  U = 85,

  Backslash = 92,

  l = 108,
  n = 110,
  t = 116,
  u = 117,
}
