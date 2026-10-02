/** The 1-based number of the first line of `text` that contains `needle`; throws when none does. */
export function lineContaining(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  if (index === -1) {
    throw new Error(`no line contains ${needle}`);
  }
  return index + 1;
}
