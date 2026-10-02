import {
  assign,
  binary,
  ite,
  num,
  type LinearExpr,
  type LinearStatement,
  ref,
} from "../../graph/linear-graph";
import {
  attributeName,
  keptName,
  landedName,
  nextName,
  overflowName,
  presentName,
  rankName,
} from "../names";

import type { PlaceLayout } from "../colour-layout";

/**
 * The end of a step for a coloured place, as a token list behaves: the
 * survivors of the sweep close up in slot order, and the produced tokens
 * land after them in sweep order. A token that finds no free slot sets the
 * place's sticky overflow flag and is dropped.
 */

export type Producer = {
  /** The producer fires this step; `null` when it always does. */
  fire: LinearExpr | null;
  /** Per produced token, the attribute values in layout order. */
  tokens: LinearExpr[][];
};

function when(fire: LinearExpr | null, condition: LinearExpr): LinearExpr {
  return fire === null ? condition : binary("&", fire, condition);
}

export function lowerCompaction(
  layout: PlaceLayout,
  producers: Producer[],
): { statements: LinearStatement[]; overflows: boolean } {
  const { place, slots } = layout;
  const statements: LinearStatement[] = [];
  function present(slot: number): LinearExpr {
    return ref(presentName(place, slot));
  }
  function attribute(slot: number, name: string): LinearExpr {
    return ref(attributeName(place, slot, name));
  }

  // rank_j: present slots below j; kept: all of them.
  statements.push({
    kind: "comment",
    text: `${place}: survivors close up in slot order`,
  });
  for (let slot = 1; slot <= slots; slot++) {
    const indicator = ite(present(slot - 1), num(1), num(0));
    statements.push(
      assign(
        slot === slots ? keptName(place) : rankName(place, slot),
        slot === 1 ? indicator : binary("+", ref(rankName(place, slot - 1)), indicator),
      ),
    );
  }
  // Slot k takes the k-th survivor: the first j >= k that is present with rank j == k.
  for (const attr of layout.attributes) {
    for (let target = 0; target < slots; target++) {
      let chain: LinearExpr = attribute(target, attr.name);
      for (let source = slots - 1; source > target; source--) {
        chain = ite(
          binary("&", present(source), binary("==", ref(rankName(place, source)), num(target))),
          attribute(source, attr.name),
          chain,
        );
      }
      statements.push(assign(nextName(attributeName(place, target, attr.name)), chain));
    }
  }
  for (const attr of layout.attributes) {
    for (let slot = 0; slot < slots; slot++) {
      const variable = attributeName(place, slot, attr.name);
      statements.push(assign(variable, ref(nextName(variable))));
    }
  }
  for (let slot = 0; slot < slots; slot++) {
    statements.push(
      assign(presentName(place, slot), binary(">=", ref(keptName(place)), num(slot + 1))),
    );
  }

  // Produced tokens land after the survivors, in sweep order.
  let overflows = false;
  if (producers.length > 0) {
    statements.push({
      kind: "comment",
      text: `${place}: produced tokens land after the survivors`,
    });
    statements.push(assign(landedName(place), ref(keptName(place))));
  }
  for (const producer of producers) {
    for (const token of producer.tokens) {
      for (let slot = 0; slot < slots; slot++) {
        const lands = when(producer.fire, binary("==", ref(landedName(place)), num(slot)));
        layout.attributes.forEach((attr, index) => {
          const variable = attributeName(place, slot, attr.name);
          statements.push(
            assign(variable, ite(lands, token[index] ?? ref(variable), ref(variable))),
          );
        });
        statements.push(assign(presentName(place, slot), binary("|", present(slot), lands)));
      }
      if (!layout.capped) {
        overflows = true;
        statements.push(
          assign(
            overflowName(place),
            binary(
              "|",
              ref(overflowName(place)),
              when(producer.fire, binary(">=", ref(landedName(place)), num(slots))),
            ),
          ),
        );
      }
      statements.push(
        assign(
          landedName(place),
          producer.fire === null
            ? binary("+", ref(landedName(place)), num(1))
            : ite(
                producer.fire,
                binary("+", ref(landedName(place)), num(1)),
                ref(landedName(place)),
              ),
        ),
      );
    }
  }
  return { statements, overflows };
}
