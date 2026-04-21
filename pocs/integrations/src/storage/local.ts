import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Storage, Uri } from "./types.js";

export type LocalStorageConfig = { root: string };

export function createLocalStorage(config: LocalStorageConfig): Storage {
  const root = resolve(config.root);

  function pathFor(key: string): string {
    if (isAbsolute(key) || key.includes("..")) {
      throw new Error(`Invalid storage key "${key}": must be a relative path without ".." segments`);
    }
    return join(root, key);
  }

  return {
    uriFor(key): Uri {
      return pathFor(key);
    },

    async exists(key) {
      try {
        await fs.access(pathFor(key));
        return true;
      } catch {
        return false;
      }
    },

    async prepareWrite(key) {
      await fs.mkdir(dirname(pathFor(key)), { recursive: true });
    },

    async prepare() {
      await fs.mkdir(root, { recursive: true });
    },
  };
}
