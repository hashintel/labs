import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
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
    name: `local:${root}`,

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

    async list(prefix) {
      const dir = pathFor(prefix);
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
        const out: string[] = [];
        for (const e of entries) {
          if (!e.isFile()) continue;
          const abs = join(e.parentPath ?? (e as unknown as { path: string }).path ?? dir, e.name);
          const rel = abs.slice(root.length + (root.endsWith(sep) ? 0 : 1));
          out.push(rel);
        }
        return out;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    },

    async remove(key) {
      try {
        await fs.unlink(pathFor(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },

    async get(key) {
      try {
        const buf = await fs.readFile(pathFor(key));
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async put(key, bytes) {
      const target = pathFor(key);
      await fs.mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.tmp-${randomBytes(6).toString("hex")}`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, target);
    },

    async prepareWrite(key) {
      await fs.mkdir(dirname(pathFor(key)), { recursive: true });
    },

    async prepare() {
      await fs.mkdir(root, { recursive: true });
    },
  };
}
