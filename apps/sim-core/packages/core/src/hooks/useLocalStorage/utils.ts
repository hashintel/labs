let defaultStorage: Storage | null = null;

try {
  defaultStorage = localStorage;
} catch {
  // Some browsers will disable localStorage.
}

const safeGetItem = (key: string, storage = defaultStorage) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export function getItem<T = any>(
  key: string,
  storage = defaultStorage,
): T | null {
  const value = safeGetItem(key, storage);

  if (value === null || typeof value === "undefined") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.debug("Could not parse `localStorage` value", error);
  }

  return null;
}

export function setItem(key: string, value: any, storage = defaultStorage) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // This catch is tech debt -- unclear why it exists.
  }
}

export function removeItem(key: string, storage = defaultStorage) {
  try {
    storage?.removeItem(key);
  } catch {
    // This catch is tech debt -- unclear why it exists.
  }
}

export function clear(storage = defaultStorage) {
  try {
    storage?.clear();
  } catch {
    // This catch is tech debt -- unclear why it exists.
  }
}
