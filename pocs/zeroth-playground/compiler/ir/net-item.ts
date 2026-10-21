/**
 * One item of a net, named as the IR names it: what a diagnostic is about,
 * and what a traced line comes from.
 */
export type NetItem = {
  kind: "net" | "place" | "transition" | "colour" | "dynamics";
  /** The IR name; the net's own name for the net. */
  name: string;
};

/** The net itself, by its name. */
export function netItem(name: string): NetItem {
  return { kind: "net", name };
}

/** The item the first two keys of an IR path name: `places.Pool` is the place Pool. */
export function itemAtPath(path: readonly PropertyKey[]): NetItem {
  const [section, entry] = path;
  const name = typeof entry === "string" ? entry : "";
  switch (section) {
    case "places":
    case "marking":
      return { kind: "place", name };
    case "transitions":
      return { kind: "transition", name };
    case "colours":
      return { kind: "colour", name };
    case "dynamics":
      return { kind: "dynamics", name };
    default:
      return netItem(typeof section === "string" ? section : "");
  }
}

export function sameItem(a: NetItem, b: NetItem): boolean {
  return a.kind === b.kind && a.name === b.name;
}

/** The item as a reader names it: `place Pool`. */
export function itemLabel(item: NetItem): string {
  return `${item.kind} ${item.name}`;
}
