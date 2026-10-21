import type { CompilerOptions } from "../compiler";

export type ExampleMeta = {
  feature: string;
  title: string;
  order: number;
  options: CompilerOptions;
};

export type Example = ExampleMeta & { id: string; ir: string };

const METAS = import.meta.glob<ExampleMeta>("./*/meta.ts", { eager: true, import: "default" });
const NETS = import.meta.glob<string>("./*/net.pn.yaml", { eager: true, query: "?raw", import: "default" });

export function folderOf(path: string): string {
  return path.split("/").at(-2) ?? path;
}

function exampleAt(path: string, meta: ExampleMeta): Example {
  const id = folderOf(path);
  const ir = NETS[`./${id}/net.pn.yaml`];
  if (ir === undefined) throw new Error(`examples/${id} has no net.pn.yaml`);
  return { ...meta, id, ir };
}

export const EXAMPLES: readonly Example[] = Object.entries(METAS)
  .map(([path, meta]) => exampleAt(path, meta))
  .toSorted((a, b) => a.order - b.order);

export const FIRST_EXAMPLE: Example = EXAMPLES[0] as Example;

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
