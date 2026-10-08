/** A rung of the ladder: the examples it holds tackle features of one kind. */
export type Rung = {
  id: "sandbox" | "atoms" | "logic" | "temporal" | "limits" | "nested" | "mtl";
  /** The rung's heading in the picker. */
  title: string;
};

/** The ladder, from one atom up; examples/README.md says what each rung holds. */
export const LADDER: readonly Rung[] = [
  { id: "sandbox", title: "Sandbox" },
  { id: "atoms", title: "One atom" },
  { id: "logic", title: "Combining" },
  { id: "temporal", title: "Temporal operators" },
  { id: "limits", title: "Limits of the base" },
  { id: "nested", title: "Nested operators (full LTL)" },
  { id: "mtl", title: "MTL: time windows" },
];

/** A group in the picker: the examples whose main construct is the same. */
export type Group = {
  id: "sandbox" | "comparators" | "and-or" | "if-iff-not" | "always-eventually" | "until" | "nested" | "mtl";
  /** The group's heading in the picker. */
  title: string;
};

/** The picker's groups, in the order it shows them. */
export const GROUPS: readonly Group[] = [
  { id: "sandbox", title: "Sandbox" },
  { id: "comparators", title: "Comparators < ≤ = ≠" },
  { id: "and-or", title: "AND / OR" },
  { id: "if-iff-not", title: "IF · IFF · NOT" },
  { id: "always-eventually", title: "ALWAYS · EVENTUALLY" },
  { id: "until", title: "UNTIL · WEAK UNTIL" },
  { id: "nested", title: "Nested" },
  { id: "mtl", title: "MTL" },
];

/** What an example's `meta.ts` declares. */
export type ExampleMeta = {
  /** What the example tackles: its name in the picker and the heading of its page. */
  feature: string;
  /** The net it uses, named above the page's heading. */
  title: string;
  /** One line on what the example shows. */
  summary: string;
  /** The question the example answers, in about 7 plain words, with no verdict. */
  question: string;
  /** The net's story in 1 or 2 plain sentences: the page's Context line, and the picker's hover footer. */
  context: string;
  /** The picker group of the example's main construct. */
  group: Group["id"];
  /** Whether the example asks the team to settle a question (EDGE-CASES.md, "Questions for the team"). */
  teamQuestion: boolean;
  rung: Rung["id"];
  /** Where it sits up the ladder: examples sort by it, lowest first. */
  order: number;
  /**
   * Shown in the picker. An unlisted example still opens from its URL hash,
   * and shows in the picker while it is the one open.
   */
  listed: boolean;
  /** Set when the constraint uses a time window: the example needs the MTL flag, and opening it turns the flag on. */
  mtl?: true;
  /** Set when the constraint nests a temporal operator in another or in a condition: the example needs the Nested operators flag, and opening it turns the flag on. */
  nested?: true;
  /** Whether the no-code builder can express the constraint. */
  builderFit: "fits" | "partly" | "breaks";
  /** Tags for what the example puts under strain. */
  stresses: string[];
  /**
   * The verdict the example's run gives. `decidedAt` is the step that decides it, or
   * `"end"` when the end-of-run rule does. Absent where the seed changes the verdict.
   */
  expect?: { verdict: "satisfied" | "violated" | "pending"; decidedAt?: number | "end" };
  /** A message the example's run is meant to produce, so the examples test accepts the error. */
  expectsDiagnostic?: string;
};

/**
 * An example as the app reads it: its folder's metadata, the folder's name
 * as its id (the picker's key, the page's key, the URL hash), its IR and its
 * constraint file, both as text.
 */
export type Example = ExampleMeta & {
  id: string;
  ir: string;
  constraint: string;
};

// One folder per example: `meta.ts`, `net.pn.yaml`, `constraint.yaml` and `page.mdx`.
const METAS = import.meta.glob<ExampleMeta>("./*/meta.ts", { eager: true, import: "default" });
const NETS = import.meta.glob<string>("./*/net.pn.yaml", { eager: true, query: "?raw", import: "default" });
const CONSTRAINTS = import.meta.glob<string>("./*/constraint.yaml", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** The folder a globbed path sits in: `./queue-always/meta.ts` is `queue-always`. */
export function folderOf(path: string): string {
  return path.split("/").at(-2) ?? path;
}

function exampleAt(path: string, meta: ExampleMeta): Example {
  const id = folderOf(path);
  const ir = NETS[`./${id}/net.pn.yaml`];
  if (ir === undefined) {
    throw new Error(`examples/${id} has a meta.ts but no net.pn.yaml`);
  }
  const constraint = CONSTRAINTS[`./${id}/constraint.yaml`];
  if (constraint === undefined) {
    throw new Error(`examples/${id} has a meta.ts but no constraint.yaml`);
  }
  return { ...meta, id, ir, constraint };
}

/** The examples up the ladder, in their `order`. */
export const EXAMPLES: readonly Example[] = Object.entries(METAS)
  .map(([path, meta]) => exampleAt(path, meta))
  .toSorted((a, b) => a.order - b.order);

/** The example the app opens on: the sandbox. */
export const DEFAULT_EXAMPLE: Example = EXAMPLES.find((example) => example.id === "sandbox") as Example;

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
