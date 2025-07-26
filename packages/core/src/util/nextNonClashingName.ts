import escapeStringRegexp from "escape-string-regexp";

export const nextNonClashingName = (name: string, existingNames: string[]) => {
  const re = new RegExp(`^${escapeStringRegexp(name)}(\\d*)$`);

  const matches = existingNames
    .map((name) => {
      const match = name.match(re)?.[1];

      if (typeof match === "string") {
        return match === "" ? 0 : parseInt(match, 10);
      }

      return null;
    })
    .filter((number): number is number => number !== null)
    .sort((a, b) => a - b);

  const suffix = matches.length ? matches[matches.length - 1] + 1 : "";

  return `${name}${suffix}`;
};
