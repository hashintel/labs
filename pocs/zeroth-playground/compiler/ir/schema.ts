import { z } from "zod";

import { checkReferences } from "./references";

/**
 * The Petri net IR: one net as plain data, with places, weighted arcs, the
 * initial marking, the firing rate or guard of each transition and, for a
 * coloured net, the token colours, the kernels that write tokens and the
 * dynamics that move them between steps. Code appears only as bare-body
 * TypeScript with the net's parameters inlined, so the document carries no
 * parameters and no layout. The compiler options are not part of it: they
 * are passed beside it.
 *
 * Places, transitions, colours, dynamics, the arcs of a transition and the
 * marking are records keyed by name. A name is UpperCamelCase, so it is
 * unique within its record and usable as a variable name in generated code.
 * A field at its default is left out, and an entry with every field at its
 * default is `null`, written as a bare key. Objects are strict, so a
 * misspelt key is reported where it stands instead of being read as a
 * default.
 *
 * This schema is the IR's only definition: the types are inferred from it.
 * `references.ts` adds the checks across sections: names declared, names
 * the Python claims, the marking against its places, `kind` against the
 * rates.
 */

/** A place, transition, colour, dynamics or arc key. */
export const PETRI_NET_IR_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/u;

/** The net's own name, which the compiler derives a module name from. */
export const PETRI_NET_IR_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const name = z
  .string()
  .regex(PETRI_NET_IR_NAME_PATTERN, "a name is UpperCamelCase: Pool, TakeLeft");

/**
 * Bare-body TypeScript for one code surface: the statements alone, ending
 * in `return`, with the input object ambient (`input` for a guard, rate or
 * kernel, `tokens` for dynamics) and the net's parameters inlined.
 */
const code = z.string();

/**
 * A token attribute's type. A string attribute the net only ever writes
 * from a finite set of literals is closed to that set as `{ enum }`, in
 * first-seen order, so a compiler can number the values.
 */
const attribute = z.union([
  z.enum(["real", "integer", "boolean", "uuid", "string"]),
  z.strictObject({ enum: z.array(z.string()) }),
]);

/** A colour: its attributes keyed by name, in declaration order. */
const colour = z.record(z.string(), attribute);

/** A differential equation shared by the places that name it. */
const dynamics = z.strictObject({
  /** The colour whose tokens it moves. */
  colour: z.string(),
  /**
   * The `dynamics` surface: `return tokens.map((token) => ({ attribute:
   * derivative, ... }));`, one derivative per real attribute it moves.
   */
  code,
});

/**
 * One arc keyed by its place; `null` is a standard arc of weight one. A
 * `read` arc needs the place to hold the weight and leaves it alone; an
 * `inhibitor` arc needs the place to hold fewer. Input arcs keep the order
 * the model gives them, which is the order token bindings are enumerated in.
 */
const arc = z
  .strictObject({
    /** Tokens the arc moves or tests. Absent means one. */
    weight: z.number().int().min(1).optional(),
    /** Absent means a standard arc, which moves its tokens. */
    kind: z.enum(["read", "inhibitor"]).optional(),
  })
  .nullable();

const arcs = z.record(name, arc);

/** A place; `null` holds any number of plain tokens. */
const place = z
  .strictObject({
    /** Maximum tokens the place holds. Absent means unbounded. */
    capacity: z.number().int().min(0).optional(),
    /** The colour of the tokens it holds. Absent means plain counting tokens. */
    colour: z.string().optional(),
    /** The `dynamics` entry that moves its tokens between steps. */
    dynamics: z.string().optional(),
  })
  .nullable();

/** One token of a coloured place, its attributes keyed by name. */
const token = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]));

/**
 * Tokens each place starts with, keyed by place: a count for a plain
 * place, one record per token for a coloured one. A place absent here
 * starts empty.
 */
const marking = z.record(name, z.union([z.number(), z.array(token)]));

const transition = z.strictObject({
  /** Input arcs keyed by place, in binding order. Absent means none. */
  inputs: arcs.optional(),
  /** Output arcs keyed by place: tokens the firing produces. Absent means none. */
  outputs: arcs.optional(),
  /**
   * A predicate transition's condition over its input tokens, a `lambda`
   * surface returning a boolean. Absent means the transition fires whenever
   * its arcs allow it.
   */
  guard: code.optional(),
  /**
   * A stochastic transition's mean firings per time unit while enabled: a
   * constant, or a `lambda` surface returning it from the input tokens.
   */
  rate: z.union([z.number(), code]).optional(),
  /**
   * The `kernel` surface that writes the produced tokens' attributes.
   * Present when an output place is coloured.
   */
  kernel: code.optional(),
  /**
   * The model marks the firing as a choice a controller makes. Absent means
   * the transition fires whenever it is enabled.
   */
  controllable: z.literal(true).optional(),
});

const net = z.strictObject({
  /** The net's own name, an identifier the module's class is named after. */
  name: z.string().regex(PETRI_NET_IR_IDENTIFIER_PATTERN, "the net's name is an identifier"),
  /** Prose about the net, for a reader. */
  description: z.string().optional(),
  /**
   * Whether every transition fires when enabled (`plain`), every transition
   * fires at a rate (`stochastic`), or the net has both (`mixed`). A
   * transition with a `rate` is stochastic; one without fires when its
   * guard holds.
   */
  kind: z.enum(["plain", "stochastic", "mixed"]),
  /** Token colours keyed by name. Absent when every place is plain. */
  colours: z.record(name, colour).optional(),
  /** Differential equations keyed by name. Absent when no place has dynamics. */
  dynamics: z.record(name, dynamics).optional(),
  places: z.record(name, place),
  /** The initial marking. Absent when every place starts empty. */
  marking: marking.optional(),
  /** Record order is the order a step sweeps the transitions in. */
  transitions: z.record(name, transition),
});

/**
 * The document: its shape, then the references between its parts, checked
 * once the shape is right.
 */
export const petriNetIrSchema = net.superRefine(checkReferences, {
  // An unknown key does not abort the parse, so the default would check the
  // references of a document whose shape is wrong.
  when: (payload) => payload.issues.length === 0,
});

export type PetriNetIr = z.infer<typeof net>;
export type PetriNetIrPlace = z.infer<typeof place>;
export type PetriNetIrTransition = z.infer<typeof transition>;
export type PetriNetIrArc = z.infer<typeof arc>;
export type PetriNetIrArcs = z.infer<typeof arcs>;
export type PetriNetIrToken = z.infer<typeof token>;
export type PetriNetIrColour = z.infer<typeof colour>;
export type PetriNetIrAttribute = z.infer<typeof attribute>;
