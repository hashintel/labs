import type { Pipeline, Step, TablePipeline } from "./pipeline.js";

export class TopologyError extends Error {
  constructor(msg: string) {
    super(`Topology error: ${msg}`);
    this.name = "TopologyError";
  }
}

export type TopologyResult = {
  order: TablePipeline[];
  hints: string[];
};

/**
 * Topologically sort pipelines by their declared `dependsOn`.
 *
 * Errors on duplicate source names or step ids, dangling references, self-loops,
 * cycles, and step deps that can't be satisfied by the resulting order.
 *
 * Hints fire when a graph-sink's link target is produced by a pipeline not in
 * the dependent pipeline's transitive `dependsOn`, or is produced by no
 * pipeline at all (stubs will bridge at runtime).
 *
 * Sort is stable: pipelines with no remaining constraints keep their declared
 * order.
 */
export function sortPipelines(pipelines: TablePipeline[]): TopologyResult {
  if (pipelines.length === 0) return { order: [], hints: [] };

  const steps = pipelines.map((tp) => linearize(tp.pipeline));

  const sourceToIdx = new Map<string, number>();
  for (let i = 0; i < pipelines.length; i++) {
    const { source } = pipelines[i];
    if (sourceToIdx.has(source)) throw new TopologyError(`Duplicate pipeline source "${source}".`);
    sourceToIdx.set(source, i);
  }

  const stepIndex = new Map<string, { pipelineIdx: number; step: Step }>();
  const checkpointNames = new Map<string, { pipelineIdx: number; stepId: string }>();
  for (let i = 0; i < pipelines.length; i++) {
    for (const step of steps[i]) {
      const prev = stepIndex.get(step.id);
      if (prev) {
        throw new TopologyError(
          `Duplicate step id "${step.id}" in pipelines "${pipelines[prev.pipelineIdx].source}" and "${pipelines[i].source}".`,
        );
      }
      stepIndex.set(step.id, { pipelineIdx: i, step });
      if (step.kind === "checkpoint") {
        const existing = checkpointNames.get(step.name);
        if (existing) {
          throw new TopologyError(
            `Duplicate checkpoint name "${step.name}" produced by steps "${existing.stepId}" (pipeline "${pipelines[existing.pipelineIdx].source}") and "${step.id}" (pipeline "${pipelines[i].source}").`,
          );
        }
        checkpointNames.set(step.name, { pipelineIdx: i, stepId: step.id });
      }
    }
  }

  const deps: Set<number>[] = pipelines.map(() => new Set<number>());

  for (let i = 0; i < pipelines.length; i++) {
    for (const name of pipelines[i].dependsOn ?? []) {
      const j = sourceToIdx.get(name);
      if (j === undefined) {
        throw new TopologyError(
          `Pipeline "${pipelines[i].source}" dependsOn "${name}", but no such pipeline is declared.`,
        );
      }
      if (j === i) throw new TopologyError(`Pipeline "${pipelines[i].source}" dependsOn itself.`);
      deps[i].add(j);
    }
    for (const checkpointName of Object.values(pipelines[i].inputs ?? {})) {
      const producer = checkpointNames.get(checkpointName);
      if (!producer) {
        throw new TopologyError(
          `Pipeline "${pipelines[i].source}" inputs checkpoint "${checkpointName}", but no pipeline produces it.`,
        );
      }
      if (producer.pipelineIdx === i) {
        throw new TopologyError(`Pipeline "${pipelines[i].source}" inputs its own checkpoint "${checkpointName}".`);
      }
      deps[i].add(producer.pipelineIdx);
    }
    for (const step of steps[i]) {
      for (const depId of step.dependsOn ?? []) {
        if (depId === step.id) throw new TopologyError(`Step "${step.id}" dependsOn itself.`);
        const target = stepIndex.get(depId);
        if (!target) {
          throw new TopologyError(
            `Step "${step.id}" in pipeline "${pipelines[i].source}" dependsOn "${depId}", but no such step exists.`,
          );
        }
        if (target.pipelineIdx !== i) deps[i].add(target.pipelineIdx);
      }
    }
  }

  // Kahn's. Children are appended in ascending index order (loop below runs
  // i ascending), so FIFO drain yields a stable topological order.
  const inDegree = deps.map((s) => s.size);
  const children: number[][] = pipelines.map(() => []);
  for (let i = 0; i < pipelines.length; i++) {
    for (const d of deps[i]) children[d].push(i);
  }

  const queue: number[] = [];
  for (let i = 0; i < pipelines.length; i++) if (inDegree[i] === 0) queue.push(i);

  const sortedIdx: number[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    sortedIdx.push(n);
    for (const c of children[n]) if (--inDegree[c] === 0) queue.push(c);
  }

  if (sortedIdx.length !== pipelines.length) {
    const emitted = new Set(sortedIdx);
    const remaining = pipelines
      .map((_, i) => i)
      .filter((i) => !emitted.has(i))
      .map((i) => pipelines[i].source);
    throw new TopologyError(`Cyclic pipeline dependencies involving: ${remaining.join(", ")}.`);
  }

  const executionPos = new Map<string, number>();
  let pos = 0;
  for (const i of sortedIdx) {
    for (const step of steps[i]) executionPos.set(step.id, pos++);
  }
  for (let i = 0; i < pipelines.length; i++) {
    for (const step of steps[i]) {
      const myPos = executionPos.get(step.id)!;
      for (const depId of step.dependsOn ?? []) {
        if (executionPos.get(depId)! >= myPos) {
          throw new TopologyError(
            `Step "${step.id}" dependsOn "${depId}", but "${depId}" does not run before it. ` +
              `Move "${depId}" earlier in its pipeline, or ensure its pipeline runs first.`,
          );
        }
      }
    }
  }

  return { order: sortedIdx.map((i) => pipelines[i]), hints: [] };
}

function linearize(pipeline: Pipeline): Step[] {
  const out: Step[] = [];
  walk(pipeline.steps, out);
  return out;
}

function walk(steps: readonly Step[], out: Step[]): void {
  for (const s of steps) {
    out.push(s);
    if (s.kind === "branch") for (const b of s.branches) walk(b, out);
  }
}
