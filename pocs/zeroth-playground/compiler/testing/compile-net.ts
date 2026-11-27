import { dump } from "js-yaml";

import { compile } from "../compile";

import type { Compilation } from "../compile";
import type { PetriNetIr } from "../ir/schema";
import type { CodeParser } from "../code/code-tree";
import type { CompilerOptions } from "../options";

/** The IR as the YAML text `compile` reads. */
export function yaml(ir: PetriNetIr): string {
  return dump(ir);
}

/** The net compiled from its YAML text. */
export function compileNet(
  ir: PetriNetIr,
  options?: CompilerOptions,
  parseCode?: CodeParser,
): Compilation {
  return compile(yaml(ir), { options, parseCode });
}

/** The main file of a net that compiles, `net.py`; throws with the refusals otherwise. */
export function pythonOf(
  ir: PetriNetIr,
  options?: CompilerOptions,
  parseCode?: CodeParser,
): string {
  const { files, errors } = compileNet(ir, options, parseCode);
  const main = files[0];
  if (main === undefined) {
    throw new Error(
      errors.map(({ item, message }) => `${item.kind} ${item.name}: ${message}`).join("; "),
    );
  }
  return main.text;
}
