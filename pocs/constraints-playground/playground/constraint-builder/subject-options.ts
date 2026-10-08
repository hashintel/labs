import type { MetricRef } from "../../constraints/ast";
import type { Names } from "./edits";
import type { PickGroup } from "./pick";

/** The subject as the picker stores it: a kind and a name. */
export function refKey(ref: MetricRef): string {
  switch (ref.kind) {
    case "metric":
      return `metric:${ref.name}`;
    case "count":
      return `count:${ref.place}`;
    case "fired":
      return `fired:${ref.transition}`;
  }
}

export function parseRefKey(key: string): MetricRef {
  const at = key.indexOf(":");
  const name = key.slice(at + 1);
  switch (key.slice(0, at)) {
    case "count":
      return { kind: "count", place: name };
    case "fired":
      return { kind: "fired", transition: name };
    default:
      return { kind: "metric", name };
  }
}

/** How a subject reads: a metric by its name, the others as the code names. */
export function refText(ref: MetricRef): string {
  switch (ref.kind) {
    case "metric":
      return ref.name;
    case "count":
      return `count(${ref.place})`;
    case "fired":
      return `fired(${ref.transition})`;
  }
}

/**
 * The subject list in three groups: the metrics, the places, the
 * transitions. A subject the net no longer names stays in its group, so the chip
 * keeps showing what the text says.
 */
export function subjectGroups(names: Names, current: MetricRef): PickGroup[] {
  const refs: MetricRef[][] = [
    names.metrics.map((name) => ({ kind: "metric", name })),
    names.places.map((place) => ({ kind: "count", place })),
    names.transitions.map((transition) => ({ kind: "fired", transition })),
  ];
  const order = ["metric", "count", "fired"];
  const at = order.indexOf(current.kind);
  if (!refs[at]?.some((ref) => refKey(ref) === refKey(current))) {
    refs[at]?.unshift(current);
  }
  return [
    { title: "Metrics", options: refs[0] ?? [] },
    { title: "Places", options: refs[1] ?? [] },
    { title: "Transitions", options: refs[2] ?? [] },
  ].map((group) => ({
    title: group.title,
    options: group.options.map((ref) => ({ value: refKey(ref), label: refText(ref) })),
  }));
}
