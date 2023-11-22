/* eslint-disable @typescript-eslint/no-var-requires */

// required to run 'monaco-editor' in the 'jest-dom' environments
// @see https://medium.com/hired-engineering/setting-up-monaco-with-jest-e1e4c963ac
import "jest-canvas-mock";

import { enableMapSet } from "immer";

jest.mock("uuid", () => ({ v4: jest.fn(() => "UUID_V4") }));
jest.mock("./features/subscribe", () => ({ subscribe: () => {} }));
jest.mock("./features/files/utils", () => {
  const module = jest.requireActual("./features/files/utils");

  return {
    ...module,
    mapFileId: jest.fn(),
  };
});

beforeEach(() => {
  const { mapFileId } = jest.requireActual("./features/files/utils");
  const mock = require("./features/files/utils").mapFileId as jest.Mock;
  mock.mockReset();
  mock.mockImplementation((...args) => mapFileId(...args));
});
// @ts-expect-error scoping issues
global.BUILD_STAMP = "JEST";

window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

enableMapSet();

document.queryCommandSupported = () => false;

/**
 * Ensure the store is properly setup for all tests – using require
 * to ensure its not sorted above the above statements which are necessary
 * for our codebase to work.
 *
 * Without this you could easily run into a missing reducer bug in our store
 * due to a circular dependency in any test using the store.
 */
require("./features/store");
