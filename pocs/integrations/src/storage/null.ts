import type { Storage } from "./types.js";

const ERR = "No Storage configured on IntegrationSpec. Supply `storage` to use checkpoints or checkpoint sources.";

export function nullStorage(): Storage {
  const reject = (): never => { throw new Error(ERR); };
  return {
    uriFor: reject,
    exists: async () => reject(),
    prepareWrite: async () => reject(),
    prepare: async () => {},
  };
}
