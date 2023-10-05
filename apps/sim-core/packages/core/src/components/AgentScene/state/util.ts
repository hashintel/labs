import {
  AtomOptions,
  ReadOnlySelectorFamilyOptions,
  ReadOnlySelectorOptions,
  SerializableParam,
  atom as recoilAtom,
  selector as recoilSelector,
  selectorFamily,
} from "recoil";
import { v4 as uuidv4 } from "uuid";

/**
 * Generates a guaranteed-to-be-unique atom
 * Is *not* compatible with deserialization
 *
 * @param options Normal selector options without key
 */
export function autoAtom<T>(options: Omit<AtomOptions<T>, "key">) {
  return recoilAtom({
    key: uuidv4(),
    ...options,
  });
}

export function autoSelector<T>(
  options: Omit<ReadOnlySelectorOptions<T>, "key">
) {
  return recoilSelector({
    key: uuidv4(),
    ...options,
    cachePolicy_UNSTABLE: {
      // needed until Recoil has better default memory management
      // otherwise ALL input/output is cached forever
      eviction: "most-recent",
    },
  });
}

export function autoreadSelectorFamily<T, S extends SerializableParam>(
  options: Omit<ReadOnlySelectorFamilyOptions<T, S>, "key">
) {
  return selectorFamily({
    key: uuidv4(),
    ...options,
    cachePolicy_UNSTABLE: {
      // needed until Recoil has better default memory management
      // otherwise ALL input/output is cached forever
      eviction: "most-recent",
    },
  });
}
