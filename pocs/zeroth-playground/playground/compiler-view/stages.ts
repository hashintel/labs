import { DWELL_MS } from "../pointer/pointer-motion";

/**
 * The parts of the compilation, as the compiler view documents them: the
 * documents that pass between steps, the steps that turn one into the next,
 * and the two side inputs of the lowering. Each entry is the text of its
 * card; the graph places them in `pipeline-layout.ts`, and `stage-sample.ts`
 * reads each one off the example in the editor.
 */

export type StageId =
  | "ir-text"
  | "parse"
  | "ir"
  | "options"
  | "code-parser"
  | "lower"
  | "graph"
  | "emit"
  | "files"
  | "trace"
  | "traces"
  | "provenance"
  | "hover"
  | "diagnostics";

/** A document passed between steps, a function, or an input beside the main line. */
export type StageKind = "data" | "step" | "input";

export type Stage = {
  id: StageId;
  kind: StageKind;
  /** Who provides it: the compiler, or the playground around it. */
  owner: "compiler" | "playground";
  /** The name on the node. */
  label: string;
  /** The line under the name on the node: its type, or what it uses. */
  note: string;
  title: string;
  /** One line: what it is or does. */
  summary: string;
  /** The call, or the type of the document. Backticks mark code in the strings below. */
  call: string;
  input: string;
  output: string;
  details: readonly string[];
};

/** Pipeline order: the order the overview lists them in and the guide numbers them. */
export const STAGES: readonly Stage[] = [
  {
    id: "ir-text",
    kind: "data",
    owner: "playground",
    label: "IR text",
    note: "YAML",
    title: "IR text",
    summary: "The Petri net IR as block-style YAML: the text the IR editor of the Examples view holds.",
    call: "irText: string",
    input: "An example, then the editor",
    output: "`parse`",
    details: [
      "Sections: `name`, `kind`, `description` (optional prose), `colours`, `dynamics`, `places`, `marking`, `transitions`.",
      "Places, transitions and arcs are records keyed by UpperCamelCase names. An entry with every field at its default is `null`, written as a bare key.",
      "The record order of `transitions` is the order a step sweeps them in.",
      "Code (`guard`, `rate`, `kernel`, `dynamics.code`) is bare-body TypeScript in a literal block.",
      "The text carries no options: they come from the panel.",
    ],
  },
  {
    id: "parse",
    kind: "step",
    owner: "compiler",
    label: "parse",
    note: "js-yaml · zod",
    title: "Parse",
    summary: "Reads the text as YAML with js-yaml, then checks it against the IR's strict zod schema, which defines the PetriNetIr type.",
    call: "parsePetriNetIr(text)",
    input: "IR text",
    output: "`{ ok: true, ir }` or `{ ok: false, errors }`",
    details: [
      "A YAML error stops the read: one `yaml-syntax` diagnostic at the line js-yaml reports. An empty text is one too, with no line.",
      "A schema failure reports every issue at once, each a `schema` diagnostic at the line of the key it concerns.",
      "Once the shape is right, the references across sections are checked: every place, colour and dynamics named is declared (`unknown-place`, `unknown-colour`, `unknown-dynamics`), no name is one the Python uses (`reserved-name`), each marking fits its place (`marking-invalid`, `marking-over-capacity`), and `kind` agrees with the rates (`kind-mismatch`).",
      "Objects are strict, so a misspelt key is reported where it stands instead of being read as a default.",
      "Place and transition names must be UpperCamelCase; the net's name must be an identifier.",
      "The schema is the IR's one definition: `PetriNetIr` is inferred from it.",
    ],
  },
  {
    id: "ir",
    kind: "data",
    owner: "compiler",
    label: "PetriNetIr",
    note: "the document",
    title: "PetriNetIr",
    summary: "The parsed document as plain data: places, arcs, the marking, rates or guards, colours and dynamics.",
    call: "PetriNetIr",
    input: "`parse`",
    output: "`lower` and `trace`",
    details: [
      "`kind` is `plain`, `stochastic` or `mixed`. A transition with a `rate` is stochastic.",
      "An arc keyed by its place: `null` is a standard arc of weight one. A `read` arc needs the weight and leaves it; an `inhibitor` arc needs fewer.",
      "A plain place starts with a count, a coloured place with one record per token.",
      "It holds no compiler options: `lower` and `trace` take them beside it.",
    ],
  },
  {
    id: "options",
    kind: "input",
    owner: "playground",
    label: "Options",
    note: "CompilerOptions",
    title: "Compiler options",
    summary: "The compiler's strategies, one per option. The Compiler options panel under the IR editor holds them, and the compile passes them beside the parsed document.",
    call: "CompilerOptions",
    input: "The Compiler options panel",
    output: "`lower` (**Shape**, **Rates**, **Time step**, **Marking**, **Conflicts**, **Control**, **Slots**) and `emit` (**Files**)",
    details: [
      "The panel groups them by what they decide: Structure, Rates, Choices, Coloured tokens. **Files** sits under **Shape**; **Time step** and **Marking** sit under **Rates**.",
      "One table, `OPTIONS`, gives each option its values, its default, the nets it applies to and why it does not apply to a net. `resolveOptions` fills every option left out with its default, **Shape** on monolithic among them. Each example opens with its own options: the modular shape wherever it compiles the net, clocks for Fork under clocks, monolithic for the coloured nets.",
      "`optionStates` greys an option that has no effect on the net. Its control reads \"not used\", and the reason takes the place of its hint: no conflict, no coloured place, clock rates.",
      "A change keeps only the options that apply and differ from their default (`optionsForNet`). `compile` keeps the same ones, drops any other with an `option-not-applicable` warning, so in the playground none appears, and reports the options in force as `compilation.options`.",
      "**Rates** on clock fixes the composition: **Shape**, **Time step**, **Marking** and **Control** no longer apply.",
    ],
  },
  {
    id: "code-parser",
    kind: "input",
    owner: "compiler",
    label: "parseCode",
    note: "not passed",
    title: "The code parser, absent",
    summary: "The setting of `compile` that reads the document's code strings into code trees. The playground does not pass one.",
    call: "parseCode?: (code, surface) => CodeFunction | undefined",
    input: "Nothing",
    output: "`lower`",
    details: [
      "A parser that would read the strings is built on the TypeScript compiler, too large for one HTML file.",
      "Without it, each code string the lowering reads is refused with `code-not-parsed`, naming its surface: `lambda`, `kernel` or `dynamics`.",
      "A net without code strings never calls it.",
      "Boiler, Drones and Bucket carry code and are refused. The refusal is part of what the playground shows.",
    ],
  },
  {
    id: "lower",
    kind: "step",
    owner: "compiler",
    label: "lower",
    note: "lowerPetriNetIr",
    title: "Lower",
    summary: "Turns the IR into a module graph in the shape the options ask for. The graph has no target syntax yet.",
    call: "lowerPetriNetIr(ir, options, parseCode)",
    input: "PetriNetIr, the options in force and the code parser",
    output: "`{ ok: true, graph }` or `{ ok: false, errors }`",
    details: [
      "**Rates** on coin gives a linear graph (`language: \"linear\"`); on clock, an SPN graph (`language: \"spn\"`).",
      "A construct it cannot express is refused per item, and the IR stays as it is. The lowering the options pick refuses by name first, before the code is read: **Shape** on modular refuses a coloured net with `modular-coloured-not-lowered` alone, so the coloured examples open on monolithic.",
      "It takes the options in force: every option that does not apply to the net is already at its default, so the lowering has nothing to warn about.",
    ],
  },
  {
    id: "graph",
    kind: "data",
    owner: "compiler",
    label: "Module graph",
    note: "linear · spn",
    title: "Module graph",
    summary: "Typed variables, the modules that drive them, and how the modules make up the system.",
    call: "LinearGraph | SpnGraph",
    input: "`lower`",
    output: "`emit` and `trace`",
    details: [
      "A linear module is typed in LIA or LRA: LIA for Int places, LRA for Real places and draws.",
      "**Shape** on modular, what the examples open with: one module per transition and per place, composed. On monolithic, the compiler's default: one module holds the whole step.",
      "Under **Marking** on Int, one LRA `Draw_` module per rated transition turns its draw into a flag. The LIA module that fires the transition reads it: its transition module, or the one module under monolithic.",
      "`X(name)` reads a variable's value in this round: an input the harness writes, or a variable another module drives. A variable has one driver, and the awaits form a DAG.",
      "SPN: a place is a Nat counter, a transition owns a Clock armed with `exp(rate)` and an Event it toggles; the clocks are hidden in the system.",
    ],
  },
  {
    id: "emit",
    kind: "step",
    owner: "compiler",
    label: "emit",
    note: "zrth.sugar",
    title: "Emit",
    summary: "Prints the graph as Python over the zrth.sugar DSL, with the emitter of the graph's language.",
    call: "emitPython(graph, layout, ir)",
    input: "Module graph, the IR and **Files**",
    output: "`CompiledFile[]`, `net.py` first, each with its trace",
    details: [
      "Linear graphs go to the linear emitter: the step method is `next`, the spelling of zrth's spn branch.",
      "SPN graphs go to the SPN emitter, with `next` and `flow` methods.",
      "Each line is written with its provenance, and the lines of a class, a method or the imports are grouped under one more. The file's trace is read off what was written, so it cannot disagree with the text.",
      "**Files** on one per module applies under **Shape** on modular or **Rates** on clock (`OPTIONS.layout`): `net.py` plus one file per module class.",
      "On one file, and always under **Shape** on monolithic, the whole program is one file, `net.py`.",
    ],
  },
  {
    id: "files",
    kind: "data",
    owner: "compiler",
    label: "Python files",
    note: "net.py first",
    title: "Python files",
    summary: "The emitted Python, `net.py` first. The Python editor of the Examples view shows one at a time, picked from the file list.",
    call: "CompiledFile[]  // { path, text, trace }",
    input: "`emit`",
    output: "The Python editor, and each file's trace to `traces`",
    details: [
      "`net.py` declares the variables and binds `net` to the system: `compose(...)` of the transition and place modules, or the one module under **Shape** on monolithic. Under **Marking** on Int, the `Draw_` modules join the compose, so on monolithic `net` is `compose(draw_…, marking)`.",
      "Under **Files** on one per module, `net.py` imports each class from its own file: `transition_birth.py` for `Transition_Birth`.",
      "None when the lowering refuses: the IR stands alone.",
    ],
  },
  {
    id: "trace",
    kind: "step",
    owner: "compiler",
    label: "trace",
    note: "line ranges",
    title: "Trace",
    summary: "Records what every line of the IR is, why it is there, and the net item it belongs to.",
    call: "traceIr(ir, irText, options)",
    input: "PetriNetIr, with the IR text it came from, and the options",
    output: "`Trace`: `{ startLine, endLine, provenance }[]`",
    details: [
      "One range per section, entry, field and arc of the YAML.",
      "The Python needs no step of its own: `emit` writes each file's trace with its text, over variables, modules, methods, statements and the system.",
      "Ranges nest, section over entry over field.",
      "The IR trace exists as soon as the text parses, whether the lowering refuses or not.",
    ],
  },
  {
    id: "traces",
    kind: "data",
    owner: "compiler",
    label: "Traces",
    note: "Trace per text",
    title: "Traces",
    summary: "The line ranges of the IR and of each shown file, each with its provenance.",
    call: "Trace  // TraceRange[]",
    input: "`trace` for the IR, `files` for the Python",
    output: "`provenanceAt`, cross-highlighting, `firstLineOf`",
    details: [
      "`what`: what the lines are, as a short noun phrase.",
      "`why`: why they are there, when the lines do not say it.",
      "`ir`: the IR path they render or compile from, such as `transitions.Serve.rate`.",
      "`source`: the place, transition, colour, dynamics or net they come from.",
    ],
  },
  {
    id: "provenance",
    kind: "step",
    owner: "compiler",
    label: "provenanceAt",
    note: "innermost range",
    title: "Provenance at a line",
    summary: "Answers for one line: the provenance of the innermost range that holds it.",
    call: "provenanceAt(trace, line)",
    input: "A trace and a 1-based line",
    output: "`Provenance`, or `null` off every range",
    details: [
      "Innermost is the shortest range holding the line; of two as short, the first.",
      "A line off every range shows no card and lights nothing.",
      "The hover card shows `what` in bold, then `why`, then the IR path and the source.",
      "Both editors share one hover provider. Each model is bound to the trace of its text, and a model showing other text gets no card.",
    ],
  },
  {
    id: "hover",
    kind: "data",
    owner: "playground",
    label: "Hover",
    note: "lit lines · card",
    title: "Hover and cross-highlighting",
    summary: "A hover in one view lights the lines and nodes that match it in the others: the IR, the Python, the net preview.",
    call: "matchingLines(trace, provenance)",
    input: "The provenance under the pointer",
    output: "Lit lines in each other editor, a lit node in the preview",
    details: [
      "Two ranges match when their sources name the same item, or, when neither has a source, when one IR path equals the other or contains it: `places.Waiting` matches `places.Waiting.capacity`.",
      "A range with a source never matches one without.",
      `The hover takes effect once the pointer has rested ${DWELL_MS} ms, so a sweep across lines lights nothing.`,
      "The editor a hover starts in lights none of its own lines; its card shows the provenance there.",
      "Under **Shape** on modular, a transition in the IR lights its variables, its module class and the line that makes its instance. Under **Shape** on monolithic, it lights its draw variable, if it has a rate, and the line of the step that sets its `fire_` flag. Under **Marking** on Int, it also lights its `Draw_` module: the class, its `hit_` variable and its instance.",
      "A node in the preview stands for its source: hovering place `Pool` lights its lines on both sides.",
    ],
  },
  {
    id: "diagnostics",
    kind: "data",
    owner: "playground",
    label: "Diagnostics",
    note: "code · message · item",
    title: "Diagnostics",
    summary: "Why the compiler refused, or what it warns about, with the IR line when one can be found.",
    call: "Diagnostic[]  // { code, message, item, line? }",
    input: "`parse` errors; `compile` warnings; `lower` errors",
    output: "The list under the Python, and marks in the IR editor",
    details: [
      "From parse: `yaml-syntax`, `schema` and the reference codes such as `unknown-place`, each at the line js-yaml or the key scan gives.",
      "From compile: `option-not-applicable`, one warning per option asked for that does not apply to the net, with the reason the panel shows.",
      "From lower: refusals by name, such as every `clocks-*` code, and refusals of code, here `code-not-parsed`.",
      "`compile` gives each diagnostic of the options and the lowering its line with `firstLineOf`: the start of the first IR trace range whose source is the diagnostic's item.",
      "A line number in the list reveals the line in the IR editor.",
    ],
  },
];

export function stageById(id: StageId): Stage {
  const stage = STAGES.find((candidate) => candidate.id === id);
  if (stage === undefined) {
    throw new Error(`no stage ${id}`);
  }
  return stage;
}
