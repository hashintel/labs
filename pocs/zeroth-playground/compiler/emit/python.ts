import {
  commentProvenance,
  compositionProvenance,
  declarationProvenance,
  hiddenProvenance,
  IMPORTS,
  instanceProvenance,
  methodProvenance,
  moduleProvenance,
  returnProvenance,
  statementProvenance,
  systemProvenance,
} from "./describe";
import { block, traced, written } from "./python-writer";

import type { ModuleGraph } from "../graph/module-graph";
import type { NetItem } from "../ir/net-item";
import type { PetriNetIr } from "../ir/schema";
import type { ResolvedOptions } from "../options";
import type { Trace } from "../trace/provenance";
import type { MethodName } from "./describe";
import type { PythonLine } from "./python-writer";

/**
 * The Python every module graph prints to, whatever its theory: the
 * declarations, a class per module with `init`, `next` and an optional
 * `flow`, the instances and the composition, in one file or one file per
 * module. A theory's emitter prints its expressions and writes its imports
 * and sort constants into a `PythonProgram`; this file writes the rest.
 */

/** One emitted Python file with the trace over its lines. */
export type CompiledFile = {
  /** Relative to the output directory, `net.py` for the main file. */
  path: string;
  text: string;
  trace: Trace;
};

/** A variable as it is declared: `Pool = Var(INT)`. */
export type PrintedVariable = {
  name: string;
  role: string;
  /** The argument of its `Var(...)`: `INT`, `Nat()`. */
  sort: string;
  comment?: string;
};

export type PrintedStatement =
  | { kind: "comment"; text: string }
  | { kind: "assign"; target: string; expr: string; comment?: string };

/** A module with its expressions printed. */
export type PrintedModule = {
  className: string;
  instance: string;
  docstring: string;
  source: NetItem;
  draw?: true;
  /** The theory its instance is built in: `LIA`, `LRA`, `SPN`. */
  theory: string;
  ctrl: readonly string[];
  extl: readonly string[];
  init: readonly string[];
  next: readonly PrintedStatement[];
  returns: readonly string[];
  flow?: readonly string[];
  /** The head of the module's own file: its imports, and the sort constants its body names. */
  file: { imports: readonly string[]; sortConstants: readonly PythonLine[] };
};

/** How the modules make up the system: one module, or all of them composed. */
export type PythonSystem =
  | { kind: "single"; module: string }
  | { kind: "compose"; modules: readonly string[]; hidden: readonly string[] };

/** A module graph as its theory prints it, for the skeleton to write out. */
export type PythonProgram = {
  language: ModuleGraph["language"];
  /** The declarations are grouped by role, in this order. */
  roles: readonly string[];
  variables: readonly PrintedVariable[];
  modules: readonly PrintedModule[];
  system: PythonSystem;
  /** The imports of `net.py` written as one file. */
  imports: readonly string[];
  /** The imports of `net.py` beside one file per module, before the imports of those modules. */
  mainImports: readonly string[];
  /** The sort constants `net.py` declares after its imports; `null` for a theory that has none. */
  sortConstants: readonly PythonLine[] | null;
};

export const INDENT = "    ";
export const LINE_WIDTH = 88;

/** A Python float literal: an integer is written with `.0`. */
export function floatLiteral(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

/** `name`, recorded in `used`: each dialect prints its sugar and zrth names through it, so the imports list what the bodies print. */
export function named(used: Set<string>, name: string): string {
  used.add(name);
  return name;
}

/** `from zrth.sugar import Module, ...`: then each of `names` the bodies use, in the order given. */
export function sugarImport(names: readonly string[], used: ReadonlySet<string>): string {
  return `from zrth.sugar import ${["Module", ...names.filter((name) => used.has(name))].join(", ")}`;
}

export function tupleLiteral(names: readonly string[]): string {
  return names.length === 1 ? `(${names[0]},)` : `(${names.join(", ")})`;
}

/**
 * `net = compose(...)` over the instances, with `hide={...}` last when some
 * variables are hidden: one line when it fits, one argument per line otherwise.
 */
export function composeLines(
  instances: readonly string[],
  hidden: readonly string[],
  ir: PetriNetIr,
): PythonLine[] {
  const hide = hidden.length > 0 ? [`hide={${hidden.join(", ")}}`] : [];
  const oneLine = `net = compose(${[...instances, ...hide].join(", ")})`;
  if (oneLine.length <= LINE_WIDTH) {
    return [traced(oneLine, systemProvenance(true, ir))];
  }
  return [
    traced("net = compose(", systemProvenance(true, ir)),
    ...instances.map((instance) => traced(`${INDENT}${instance},`, compositionProvenance(ir))),
    ...hide.map((arg) => traced(`${INDENT}${arg},`, hiddenProvenance(ir))),
    traced(")", compositionProvenance(ir)),
  ];
}

/** `Transition_FooBar` → `transition_foo_bar`: the Python module a class file imports as. */
export function moduleFileStem(className: string): string {
  return className
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * One stem per module. IR names differ by case alone at times, `Ab` and `AB`,
 * and lowercasing joins them, so a later module that lands on a taken stem
 * gets a numbered one: `place_ab`, `place_ab_2`.
 */
export function moduleFileStems(classNames: readonly string[]): ReadonlyMap<string, string> {
  const taken = new Set<string>();
  const stems = new Map<string, string>();
  for (const className of classNames) {
    const base = moduleFileStem(className);
    let stem = base;
    for (let index = 2; taken.has(stem); index += 1) {
      stem = `${base}_${index}`;
    }
    taken.add(stem);
    stems.set(className, stem);
  }
  return stems;
}

/** The declarations in groups by role, a blank line between groups. */
function declarations(program: PythonProgram, ir: PetriNetIr): PythonLine[] {
  const groups = program.roles
    .map((role) =>
      program.variables
        .filter((variable) => variable.role === role)
        .map((variable) =>
          traced(
            `${variable.name} = Var(${variable.sort})${variable.comment === undefined ? "" : `  # ${variable.comment}`}`,
            declarationProvenance(variable, ir),
          ),
        ),
    )
    .filter((group) => group.length > 0);
  return groups.flatMap((group, index) => (index === 0 ? group : ["", ...group]));
}

function statementLine(statement: PrintedStatement, ir: PetriNetIr): PythonLine {
  if (statement.kind === "comment") {
    return traced(`${INDENT}${INDENT}# ${statement.text}`, commentProvenance(statement.text));
  }
  const trailer = statement.comment === undefined ? "" : `  # ${statement.comment}`;
  return traced(
    `${INDENT}${INDENT}${statement.target} = ${statement.expr}${trailer}`,
    statementProvenance(statement, ir),
  );
}

function method(
  language: PythonProgram["language"],
  name: MethodName,
  parameters: readonly string[],
  body: readonly PythonLine[],
  returns: readonly string[],
): PythonLine {
  return block(methodProvenance(language, name), [
    `${INDENT}def ${name}(${parameters.join(", ")}):`,
    ...body,
    traced(`${INDENT}${INDENT}return ${returns.join(", ")}`, returnProvenance(name)),
  ]);
}

function classLines(
  language: PythonProgram["language"],
  module: PrintedModule,
  ir: PetriNetIr,
): PythonLine {
  const parameters = ["self", ...module.ctrl, ...module.extl];
  const { flow } = module;
  return block(moduleProvenance(module), [
    `class ${module.className}(Module):`,
    `${INDENT}"""${module.docstring}"""`,
    "",
    method(language, "init", ["self", ...module.extl], [], module.init),
    "",
    method(
      language,
      "next",
      parameters,
      module.next.map((statement) => statementLine(statement, ir)),
      module.returns,
    ),
    ...(flow === undefined ? [] : ["", method(language, "flow", parameters, [], flow)]),
  ]);
}

function construction(module: PrintedModule): string {
  const extl = module.extl.length > 0 ? `, extl=${tupleLiteral(module.extl)}` : "";
  return `${module.className}(theory=${module.theory}, ctrl=${tupleLiteral(module.ctrl)}${extl})`;
}

/** The lines that bind `net`: the one module's instance, or each instance and their composition. */
function systemLines(program: PythonProgram, ir: PetriNetIr): PythonLine[] {
  const byInstance = new Map(program.modules.map((module) => [module.instance, module]));
  function moduleOf(instance: string): PrintedModule {
    const module = byInstance.get(instance);
    if (module === undefined) {
      throw new Error(`the root names module ${instance}, which does not exist`);
    }
    return module;
  }
  const { system } = program;
  if (system.kind === "single") {
    return [traced(`net = ${construction(moduleOf(system.module))}`, systemProvenance(false, ir))];
  }
  return [
    ...system.modules.map((instance) => {
      const module = moduleOf(instance);
      return traced(
        `${instance} = ${construction(module)}`,
        instanceProvenance(module, module.theory),
      );
    }),
    ...composeLines(system.modules, system.hidden, ir),
  ];
}

/**
 * The program as `net.py` alone, or as `net.py` first and one file per
 * module. Run from the directory the files are written to, `net.py`
 * imports each module by its file name.
 */
export function pythonFiles(
  program: PythonProgram,
  layout: ResolvedOptions["layout"],
  ir: PetriNetIr,
): CompiledFile[] {
  const sortConstants = program.sortConstants === null ? [] : [...program.sortConstants, ""];
  const declared = declarations(program, ir);
  const system = systemLines(program, ir);
  if (layout === "single") {
    const lines = [
      block(IMPORTS, program.imports),
      "",
      ...sortConstants,
      ...declared,
      ...program.modules.flatMap((module) => ["", "", classLines(program.language, module, ir)]),
      "",
      "",
      ...system,
    ];
    return [{ path: "net.py", ...written(lines) }];
  }
  const stems = moduleFileStems(program.modules.map((module) => module.className));
  function stemOf(className: string): string {
    return stems.get(className) ?? moduleFileStem(className);
  }
  const main = [
    block(IMPORTS, [
      ...program.mainImports,
      "",
      ...program.modules.map(
        (module) => `from ${stemOf(module.className)} import ${module.className}`,
      ),
    ]),
    "",
    ...sortConstants,
    ...declared,
    "",
    "",
    ...system,
  ];
  return [
    { path: "net.py", ...written(main) },
    ...program.modules.map((module) => {
      const lines = [
        block(IMPORTS, module.file.imports),
        ...(module.file.sortConstants.length > 0 ? ["", ...module.file.sortConstants] : []),
        "",
        "",
        classLines(program.language, module, ir),
      ];
      return { path: `${stemOf(module.className)}.py`, ...written(lines) };
    }),
  ];
}
