import type { CompilerOptions } from "../compiler";

/** A rung of the ladder: the examples it holds tackle features of one kind. */
export type Rung = {
  id: "steps" | "rates" | "colours";
  title: string;
  about: string;
};

/** The ladder, from the plainest net up. */
export const LADDER: readonly Rung[] = [
  { id: "steps", title: "Steps", about: "Plain nets: how one step of the net becomes modules" },
  { id: "rates", title: "Rates", about: "Stochastic nets: coins tested each step, or clocks in continuous time" },
  { id: "colours", title: "Coloured tokens", about: "Attributes, dynamics and kernels; not compiled here yet" },
];

/** What an example's `meta.ts` declares. */
export type ExampleMeta = {
  /** What the example tackles: its name in the picker and the heading of its page. */
  feature: string;
  /** The net it uses, named above the page's heading. */
  title: string;
  /** One line on what the example shows. */
  summary: string;
  rung: Rung["id"];
  /** Where it sits up the ladder: examples sort by it, lowest first. */
  order: number;
  /**
   * Shown in the picker. An unlisted example still opens from its URL hash,
   * and shows in the picker while it is the one open.
   */
  listed: boolean;
  /**
   * The compiler options the example opens with; the panel edits them from
   * there. The playground opens a net in the modular shape wherever that shape
   * compiles it: coloured nets and nets with dynamics stay monolithic.
   */
  options: CompilerOptions;
};

/**
 * An example as the app reads it: its folder's metadata, the folder's name
 * as its id (the picker's key, the page's key, the URL hash), and its IR.
 */
export type Example = ExampleMeta & {
  id: string;
  /** The IR document; the options sit beside it, in `options`. */
  ir: string;
};

// One folder per example: `meta.ts`, `net.pn.yaml` and `page.mdx`.
const METAS = import.meta.glob<ExampleMeta>("./*/meta.ts", { eager: true, import: "default" });
const NETS = import.meta.glob<string>("./*/net.pn.yaml", { eager: true, query: "?raw", import: "default" });

/** The folder a globbed path sits in: `./queue/meta.ts` is `queue`. */
export function folderOf(path: string): string {
  return path.split("/").at(-2) ?? path;
}

function exampleAt(path: string, meta: ExampleMeta): Example {
  const id = folderOf(path);
  const ir = NETS[`./${id}/net.pn.yaml`];
  if (ir === undefined) {
    throw new Error(`examples/${id} has a meta.ts but no net.pn.yaml`);
  }
  return { ...meta, id, ir };
}

/** The examples up the ladder, in their `order`. */
export const EXAMPLES: readonly Example[] = Object.entries(METAS)
  .map(([path, meta]) => exampleAt(path, meta))
  .toSorted((a, b) => a.order - b.order);

export const FIRST_EXAMPLE: Example = EXAMPLES[0] as Example;

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
