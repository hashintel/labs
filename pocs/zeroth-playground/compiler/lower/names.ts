import { netClassName } from "../ir/reserved-names";

import type { NetItem } from "../ir/net-item";

/**
 * The identifiers the lowerings coin, and how each reads back into words.
 *
 * A coined identifier is a prefix and its parts joined by underscores:
 * `fire_Go`, `take_Launch_Hangar_2`. An IR name is UpperCamelCase and
 * carries no underscore, so a coined name cannot collide with one, and the
 * prefix and the parts split without ambiguity. An attribute name is the
 * user's own and may carry underscores, so it is always the last part and
 * takes the rest. Two coined names have no prefix: a slot of a coloured
 * place (`Hangar_1_present`, `Hangar_1_battery`), which starts with its
 * place, and the time reference `t`, a bare lowercase letter.
 *
 * Every prefix has one entry in `PREFIXES`, its reading; a coin function
 * can only use a prefix that has one.
 */

/** A coined identifier read back: what it holds, why when the name alone does not say, and its item. */
export type NameReading = {
  what: string;
  why?: string;
  source?: NetItem;
};

type Prefixed = {
  /** The kind of item the first part names; absent when the reading finds its own. */
  item?: "transition" | "place";
  /** The reading, from the parts after the prefix. */
  read(parts: readonly string[]): NameReading;
};

const PREFIXES = {
  fire: {
    item: "transition",
    read: ([transition]) => ({
      what: `${transition} fires this step`,
      why: "The transition's module drives it; the places it touches await it.",
    }),
  },
  u: {
    item: "transition",
    read: ([transition]) => ({
      what: `Uniform draw for ${transition}, each step`,
      why: "An input the harness writes; the transition fires when the draw is at least e^(-rate·dt).",
    }),
  },
  hit: {
    item: "transition",
    read: ([transition]) => ({
      what: `${transition}'s draw passed its threshold`,
      why: "Driven by the transition's Draw module, so the places stay Int.",
    }),
  },
  go: {
    item: "transition",
    read: ([transition]) => ({
      what: `External choice for ${transition}`,
      why: "A controllable transition also waits for a controller to choose it.",
    }),
  },
  pick: {
    item: "transition",
    read: ([transition]) => ({
      what: `The environment lets ${transition} fire this step`,
      why: "An input nothing drives: any resolution of the conflict is a run, and a proof ranges over all of them.",
    }),
  },
  fill: {
    item: "place",
    read: ([place]) => ({
      what: `${place}'s tokens if the step ended now`,
      why: "A capped place: a producer checks the room left before adding.",
    }),
  },
  avail: {
    item: "place",
    read: ([place]) => ({
      what: `${place}'s tokens after the transitions swept so far`,
      why: "A later transition sees what the earlier ones took.",
    }),
  },
  e: {
    item: "transition",
    read: ([transition]) => ({
      what: `Exponential draw for ${transition}'s token-dependent rate`,
      why: "-ln(u) / dt, compared with the rate the tokens give.",
    }),
  },
  z: {
    item: "transition",
    read: ([transition, index]) => ({
      what: `Gaussian draw ${index ?? ""} of ${transition}'s kernel`,
      why: "A kernel's distribution with a constant spread becomes an input the harness draws.",
    }),
  },
  v: {
    item: "transition",
    read: ([transition, index]) => ({
      what: `Uniform draw ${index ?? ""} of ${transition}'s kernel`,
      why: "A kernel's distribution with a constant spread becomes an input the harness draws.",
    }),
  },
  ok: {
    item: "transition",
    read: ([transition]) => ({
      what: `${transition} is structurally enabled`,
      why: "Its input places hold enough tokens, before any guard.",
    }),
  },
  bind: {
    item: "transition",
    read: ([transition, index]) => ({
      what: `Combination ${index ?? ""} of ${transition}'s tokens passes its guard`,
    }),
  },
  sel: {
    item: "transition",
    read: ([transition, index]) => ({
      what: `Combination ${index ?? ""} is the first of ${transition}'s that passes`,
      why: "Combinations are tried in binding order, the last arc fastest, and the first passing one fires.",
    }),
  },
  seen: {
    item: "transition",
    read: ([transition]) => ({ what: `Some combination of ${transition} up to here passed` }),
  },
  take: {
    item: "transition",
    read: ([transition, place, slot]) => ({
      what: `${transition} takes the token in slot ${slot ?? ""} of ${place ?? ""}`,
    }),
  },
  out: {
    item: "transition",
    read: ([transition, place, index, ...attribute]) => ({
      what: `${attribute.join("_")} of token ${index ?? ""} that ${transition} produces into ${place ?? ""}`,
    }),
  },
  rank: {
    item: "place",
    read: ([place, slot]) => ({
      what: `Present slots of ${place} below slot ${slot ?? ""}, once the sweep is done`,
      why: "Survivors close up in slot order; a token's rank is its landing slot.",
    }),
  },
  kept: {
    item: "place",
    read: ([place]) => ({ what: `Tokens ${place} keeps after the sweep` }),
  },
  landed: {
    item: "place",
    read: ([place]) => ({ what: `The slot the next token produced into ${place} lands in` }),
  },
  next: {
    read: (parts) => {
      const variable = parts.join("_");
      const source = describeName(variable)?.source;
      return {
        what: `${variable} once the survivors closed up`,
        ...(source === undefined ? {} : { source }),
      };
    },
  },
  overflow: {
    item: "place",
    read: ([place]) => ({
      what: `A token produced into ${place} found no free slot`,
      why: "The place has more tokens than slots; raise its capacity or the slots option.",
    }),
  },
  clk: {
    item: "transition",
    read: ([transition]) => ({
      what: `Time left until ${transition} fires`,
      why: "Armed with exp(rate) when the transition fires, run down against t while its arcs allow it; hidden in the composition.",
    }),
  },
  ev: {
    item: "transition",
    read: ([transition]) => ({
      what: `Toggles when ${transition} fires`,
      why: "An event fires by changing value; a place reads it with fired().",
    }),
  },
  fires: {
    item: "transition",
    read: ([transition]) => ({ what: `${transition}'s clock ran out and its arcs allow it` }),
  },
  fired: {
    item: "transition",
    read: ([transition]) => ({
      what: `${transition} fired this step`,
      why: "Its event differs between the latched value and the next.",
    }),
  },
} satisfies Record<string, Prefixed>;

type Prefix = keyof typeof PREFIXES;

function coin(prefix: Prefix, ...parts: (string | number)[]): string {
  return [prefix, ...parts].join("_");
}

export function fireName(transition: string): string {
  return coin("fire", transition);
}

export function drawName(transition: string): string {
  return coin("u", transition);
}

export function hitName(transition: string): string {
  return coin("hit", transition);
}

export function choiceName(transition: string): string {
  return coin("go", transition);
}

/** The environment's pick a transition in a conflict waits for, under `conflicts: nondet`. */
export function pickName(transition: string): string {
  return coin("pick", transition);
}

export function fillName(place: string): string {
  return coin("fill", place);
}

export function availableName(place: string): string {
  return coin("avail", place);
}

/** The exponential draw a token-dependent rate is tested against: `-ln(u) / dt`. */
export function exponentialDrawName(transition: string): string {
  return coin("e", transition);
}

/** The k-th standard-normal or uniform draw a kernel takes. */
export function kernelDrawName(transition: string, kind: "z" | "v", index: number): string {
  return coin(kind, transition, index);
}

export function enabledName(transition: string): string {
  return coin("ok", transition);
}

export function bindName(transition: string, index: number): string {
  return coin("bind", transition, index);
}

export function selectName(transition: string, index: number): string {
  return coin("sel", transition, index);
}

export function seenName(transition: string): string {
  return coin("seen", transition);
}

export function takeName(transition: string, place: string, slot: number): string {
  return coin("take", transition, place, slot);
}

export function outName(
  transition: string,
  place: string,
  index: number,
  attribute: string,
): string {
  return coin("out", transition, place, index, attribute);
}

export function rankName(place: string, slot: number): string {
  return coin("rank", place, slot);
}

export function keptName(place: string): string {
  return coin("kept", place);
}

export function landedName(place: string): string {
  return coin("landed", place);
}

export function nextName(variable: string): string {
  return coin("next", variable);
}

export function overflowName(place: string): string {
  return coin("overflow", place);
}

export function clockName(transition: string): string {
  return coin("clk", transition);
}

export function eventName(transition: string): string {
  return coin("ev", transition);
}

export function firesName(transition: string): string {
  return coin("fires", transition);
}

export function firedName(transition: string): string {
  return coin("fired", transition);
}

/** A slot of a coloured place holds a token. */
export function presentName(place: string, slot: number): string {
  return `${place}_${slot}_present`;
}

/** One attribute of the token in a slot. */
export function attributeName(place: string, slot: number, attribute: string): string {
  return `${place}_${slot}_${attribute}`;
}

const SLOT = /^([A-Z][A-Za-z0-9]*)_(\d+)_([A-Za-z_][\w]*)$/u;

function readSlot(place: string, slot: string, attribute: string): NameReading {
  const source: NetItem = { kind: "place", name: place };
  return attribute === "present"
    ? {
        what: `Slot ${slot} of ${place} holds a token`,
        why: "A coloured place is a fixed row of slots, each with a present flag and one variable per attribute.",
        source,
      }
    : { what: `${attribute} of the token in slot ${slot} of ${place}`, source };
}

/** The external time reference every clock runs down against. */
export const timeReference = "t";

const TIME_READING: NameReading = {
  what: "The time reference",
  why: "External and driven by nothing: a clock's flow is a rate against d(t), so a module that reads it awaits t.",
};

function isPrefix(prefix: string): prefix is Prefix {
  return Object.hasOwn(PREFIXES, prefix);
}

/** A coined identifier read back into words, or `null` for a name the lowerings do not coin. */
export function describeName(name: string): NameReading | null {
  if (name === timeReference) {
    return TIME_READING;
  }
  const slot = SLOT.exec(name);
  if (slot !== null) {
    const [, place = "", index = "", attribute = ""] = slot;
    return readSlot(place, index, attribute);
  }
  const [prefix = "", ...parts] = name.split("_");
  const [first] = parts;
  if (first === undefined || !isPrefix(prefix)) {
    return null;
  }
  const family: Prefixed = PREFIXES[prefix];
  const reading = family.read(parts);
  return family.item === undefined
    ? reading
    : { ...reading, source: { kind: family.item, name: first } };
}

/** A module's class, its instance, and the net item it stands for. */
export type ModuleNames = {
  className: string;
  instance: string;
  source: NetItem;
  draw?: true;
};

export function transitionModuleNames(transition: string): ModuleNames {
  return {
    className: `Transition_${transition}`,
    instance: `transition_${transition}`,
    source: { kind: "transition", name: transition },
  };
}

export function placeModuleNames(place: string): ModuleNames {
  return {
    className: `Place_${place}`,
    instance: `place_${place}`,
    source: { kind: "place", name: place },
  };
}

export function drawModuleNames(transition: string): ModuleNames {
  return {
    className: `Draw_${transition}`,
    instance: `draw_${transition}`,
    source: { kind: "transition", name: transition },
    draw: true,
  };
}

/** The whole net's module; its instance is named when it is composed with others. */
export function netModuleNames(netName: string): ModuleNames {
  return {
    className: netClassName(netName),
    instance: "marking",
    source: { kind: "net", name: netName },
  };
}
