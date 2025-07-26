// Adapted from https://github.com/microsoft/vscode/blob/a1de2a783afd8c9e64d3ddbf517df727f9f6cdef/src/vs/base/common/strings.ts
// To keep the bundle small, this contains just the functions we need

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function containsUppercaseCharacter(target: string): boolean {
  return !target ? false : target.toLowerCase() !== target;
}
