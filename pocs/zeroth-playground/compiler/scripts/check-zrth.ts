/**
 * Checks that the Python the compiler writes constructs under zrth. Every
 * example is compiled under the options it opens with and under each variant
 * `optionVariants` lists; each compiled net is written to a temporary folder
 * and imported by `construct_net.py`, in the zrth checkout ZRTH_PATH names.
 * A net the compiler refuses is reported as refused and not run.
 *
 *   ZRTH_PATH=/path/to/zrth pnpm check:zrth
 *
 * It prints one row per example and option set, then each raise with the
 * generated lines it passed through, and exits 1 when anything raises.
 */
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { compile, parsePetriNetIr } from "../index";
import { optionsLabel, optionVariants } from "./option-variants";

import type { CompiledFile, CompilerOptions } from "../index";

const run = promisify(execFile);

const EXAMPLES = path.resolve(import.meta.dirname, "../../examples");
const RUNNER = path.resolve(import.meta.dirname, "construct_net.py");

const USAGE = `check:zrth imports the Python the compiler writes for every example into zrth.
Set ZRTH_PATH to a checkout of zrth, Zeroth's reactive-modules library, at the commit to
check against, with its Python package built (just py-rebuild) and uv on the PATH.
compiler/README.md gives the setup.

  ZRTH_PATH=/path/to/zrth pnpm check:zrth`;

type Frame = { file: string; line: number; code: string };

type Outcome =
  | { kind: "constructs" }
  | { kind: "raises"; error: string; frames: Frame[]; folder: string }
  | { kind: "refused"; codes: string[] };

type Example = { id: string; order: number; opening: CompilerOptions; ir: string };

type Case = { example: string; options: CompilerOptions; opening: boolean };

type Compiled = Case & ({ files: CompiledFile[] } | { codes: string[] });

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function readExample(id: string): Promise<Example> {
  const folder = path.join(EXAMPLES, id);
  const meta = (
    (await import(pathToFileURL(path.join(folder, "meta.ts")).href)) as {
      default: { order: number; options: CompilerOptions };
    }
  ).default;
  return {
    id,
    order: meta.order,
    opening: meta.options,
    ir: readFileSync(path.join(folder, "net.pn.yaml"), "utf8"),
  };
}

async function readExamples(): Promise<Example[]> {
  const ids = readdirSync(EXAMPLES, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(path.join(EXAMPLES, entry.name, "net.pn.yaml")),
    )
    .map((entry) => entry.name);
  const examples = await Promise.all(ids.map(readExample));
  return examples.toSorted((a, b) => a.order - b.order);
}

function casesOf(example: Example): Case[] {
  const parsed = parsePetriNetIr(example.ir);
  if (!parsed.ok) {
    fail(
      `examples/${example.id}/net.pn.yaml is not an IR: ${parsed.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return optionVariants(parsed.ir, example.opening).map((options, index) => ({
    example: example.id,
    options,
    opening: index === 0,
  }));
}

function compiled(example: Example, entry: Case): Compiled {
  const { files, errors } = compile(example.ir, { options: entry.options });
  return errors.length > 0
    ? { ...entry, codes: [...new Set(errors.map((error) => error.code))] }
    : { ...entry, files };
}

function writeFiles(folder: string, files: readonly CompiledFile[]): void {
  mkdirSync(folder, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(folder, file.path), file.text);
  }
}

/** The last line of a process's output: where Python prints the exception that ended it. */
function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}

async function construct(zrth: string, folder: string): Promise<Outcome> {
  try {
    const { stdout } = await run("uv", ["run", "--no-sync", "python", RUNNER, folder], {
      cwd: zrth,
    });
    const result = JSON.parse(lastLine(stdout)) as
      | { ok: true }
      | { ok: false; error: string; frames: Frame[] };
    return result.ok
      ? { kind: "constructs" }
      : { kind: "raises", error: result.error, frames: result.frames, folder };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    return { kind: "raises", error: lastLine(stderr), frames: [], folder };
  }
}

/** Runs each item through `task`, at most `size` at a time, and keeps the results in order. */
async function inPool<T, R>(
  items: readonly T[],
  size: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

async function checkZrthRuns(zrth: string): Promise<void> {
  try {
    await run("uv", ["run", "--no-sync", "python", "-c", "import zrth.sugar"], { cwd: zrth });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    fail(
      `${USAGE}\n\nzrth does not import from ${zrth}: ${stderr === undefined ? String(error) : lastLine(stderr)}`,
    );
  }
}

function resultText(outcome: Outcome): string {
  return outcome.kind === "refused" ? `refused: ${outcome.codes.join(", ")}` : outcome.kind;
}

function table(rows: readonly (readonly string[])[]): string {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function report(results: readonly (Case & { outcome: Outcome })[]): string {
  const rows = results.map(({ example, options, opening, outcome }) => [
    example,
    `${optionsLabel(options)}${opening ? " (opens with)" : ""}`,
    resultText(outcome),
  ]);
  const raises = results.flatMap(({ example, options, outcome }) =>
    outcome.kind === "raises"
      ? [
          [
            `${example}, ${optionsLabel(options)}: ${outcome.error}`,
            ...outcome.frames.map((frame) => `    ${frame.file}:${frame.line}  ${frame.code}`),
            `    files in ${outcome.folder}`,
          ].join("\n"),
        ]
      : [],
  );
  const count = (kind: Outcome["kind"]) =>
    results.filter(({ outcome }) => outcome.kind === kind).length;
  return [
    table([["example", "options", "result"], ...rows]),
    "",
    `${count("constructs")} construct, ${count("raises")} raise, ${count("refused")} refused.`,
    ...(raises.length === 0 ? [] : ["", "Raises:", ...raises]),
  ].join("\n");
}

const zrth = process.env["ZRTH_PATH"];
if (zrth === undefined || zrth === "") {
  fail(`${USAGE}\n\nZRTH_PATH is not set.`);
}
if (!existsSync(zrth)) {
  fail(`${USAGE}\n\nZRTH_PATH names no folder: ${zrth}`);
}
await checkZrthRuns(zrth);

const examples = await readExamples();
const cases = examples.flatMap((example) =>
  casesOf(example).map((entry) => compiled(example, entry)),
);
const scratch = mkdtempSync(path.join(tmpdir(), "check-zrth-"));
const results = await inPool(cases, availableParallelism(), async (entry, index) => {
  if ("codes" in entry) {
    return { ...entry, outcome: { kind: "refused", codes: entry.codes } satisfies Outcome };
  }
  const folder = path.join(scratch, `${index}-${entry.example}`);
  writeFiles(folder, entry.files);
  return { ...entry, outcome: await construct(zrth, folder) };
});

console.log(report(results));
const raised = results.some(({ outcome }) => outcome.kind === "raises");
if (!raised) {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = raised ? 1 : 0;
