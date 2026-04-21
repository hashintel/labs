import type { Storage } from "./types.js";

const ERR = "No Storage configured on IntegrationSpec. Supply `storage` to use checkpoints or checkpoint sources.";

export function nullStorage(): Storage {
  const reject = (): never => { throw new Error(ERR); };
  return {
    name: "null",
    uriFor: reject,
    exists: async () => reject(),
    list: async () => reject(),
    remove: async () => reject(),
    get: async () => reject(),
    put: async () => reject(),
    prepareWrite: async () => reject(),
    prepare: async () => {},
  };
}
