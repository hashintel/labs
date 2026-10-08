/**
 * The team's technical terms that pages use, each with one plain line. A
 * page wraps a term in `<Term>`, which underlines it and shows this line on
 * hover and on focus.
 */
export const GLOSSARY = {
  atom: "One comparison, like count(Shelf) > 0.",
  base: "The simple rules: one ALWAYS, EVENTUALLY or UNTIL at the top.",
  contradiction: "A condition no state can pass.",
  deadlock: "Nothing can fire any more, so the run stops.",
  "De Morgan": "NOT (A OR B) is (NOT A) AND (NOT B).",
  horizon: "The step where the run is cut off (maxSteps).",
  "inclusive bound": "A limit that includes its own value: ≥ or ≤.",
  interleaving: "Transitions fire one at a time, never together.",
  margin: "How far the value is from the bound at a step.",
  metric: "A named value worked out from counts and firings, like Waiting = count(Queue).",
  MTL: "Rules whose ALWAYS or EVENTUALLY has a time window.",
  nested: "A time operator inside another, like ALWAYS (… EVENTUALLY …).",
  "per-token": "About each token on its own, not the total in a place.",
  precedence: "Which joins first without brackets: AND before OR.",
  "strict bound": "A limit that leaves out its own value: > or <.",
  "strong until": "A UNTIL B, where B must come before the run ends.",
  tautology: "A condition every state passes, so the rule cannot fail.",
  "time window": "A span of time the rule looks at, like [0, 30].",
  vacuous: "Passes only because the IF part never became true.",
  "weak until": "A UNTIL B, where B may never come if A holds to the end.",
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;

/** The glossary line for a term, or undefined when the glossary lacks it. */
export function meaningOf(term: string): string | undefined {
  return Object.hasOwn(GLOSSARY, term) ? GLOSSARY[term as GlossaryTerm] : undefined;
}
