// The "llm:skill" plugin for Patchwork's chat computer: instructions for
// building and editing Petrinaut nets with the chat's generic document tools
// (read_doc / automerge_op). Auto-activates when the focused document is a
// petrinaut-petrinet (see the registration in index.ts).
//
// This is the counterpart to SKILL.md + skill-api.ts, which serve the
// "patchwork:skill" plugin — a documented API surface. The chat computer has
// no such API, only raw Automerge ops, so the net's schema has to be spelled
// out here.

const INSTRUCTIONS = `
Build and edit Petrinaut nets — Stochastic Dynamic Coloured Petri Nets (SDCPNs)
— by editing the document directly with read_doc and automerge_op. The
Petrinaut tool renders your changes live.

### Document shape

{ "@patchwork": { "type": "petrinaut-petrinet" }, "title": "...",
  "petriNetDefinition": { "places": [], "transitions": [], "types": [],
    "parameters": [], "differentialEquations": [], "scenarios": [],
    "metrics": [] } }

Everything below lives under "petriNetDefinition". "scenarios" and "metrics"
are optional and may be absent on older nets. The title is a TOP-LEVEL field,
not part of the net: set it with path [], range "title".

Places are states that hold tokens; transitions are the events that move
tokens between them. Every id is a fresh UUID you generate.

Place — x/y are canvas coordinates, so spread nodes out (~150–250 apart) or
they land on top of each other:
{ "id": "<uuid>", "name": "Susceptible", "colorId": null,
  "dynamicsEnabled": false, "differentialEquationId": null, "x": 100, "y": 100 }

Transition — every input arc needs a "type"; output arcs do not have one:
{ "id": "<uuid>", "name": "infection",
  "inputArcs": [{ "placeId": "<placeId>", "weight": 1, "type": "standard" }],
  "outputArcs": [{ "placeId": "<placeId>", "weight": 1 }],
  "lambdaType": "stochastic", "lambdaCode": "...",
  "transitionKernelCode": "...", "x": 300, "y": 100 }

An arc "type" of "inhibitor" instead blocks the transition while the place
holds tokens, and its place is NOT passed to the lambda. "weight" is how many
tokens the arc consumes or produces.

Colour type (only needed when tokens carry attributes):
{ "id": "<uuid>", "name": "Person", "iconSlug": "circle",
  "displayColor": "#2196f3",
  "elements": [{ "elementId": "<uuid>", "name": "age", "type": "real" }] }

Parameter — code reads it as parameters.<variableName>, so variableName must
be lower_snake_case:
{ "id": "<uuid>", "name": "Infection rate", "variableName": "infection_rate",
  "type": "real", "defaultValue": "0.3" }

Differential equation (continuous dynamics for a coloured place):
{ "id": "<uuid>", "name": "Ageing", "colorId": "<colourId>", "code": "..." }

### Editing recipes (automerge_op)

Append a place: path ["petriNetDefinition","places"], range [N,N],
value [ <the place object> ] — N is the current array length, so read_doc first.
Transitions, types, parameters and differentialEquations work the same way.

Rename a place: path ["petriNetDefinition","places",<index>], range "name",
value "New name".
Set a rate: path ["petriNetDefinition","parameters",<index>], range
"defaultValue", value "0.5".
Retitle the net: path [], range "title", value "SIR epidemic".
Delete a transition: path ["petriNetDefinition","transitions"],
range [<index>,<index>+1], with no value.

Never change "@patchwork".type. Automerge cannot store undefined — omit a key
rather than setting it to undefined.

### Rules that will bite you

Place NAMES are part of the code surface: lambdas read input.PlaceName, kernels
return { PlaceName: [...] }, and metrics read state.places.PlaceName.count.
Renaming a place means updating every lambda, kernel, metric and visualizer
that mentions it, in the same batch, or you silently break them.

Deleting a place means also deleting every inputArc/outputArc that references
its id, and clearing any differentialEquationId or colorId pointing at
something you removed. A dangling arc breaks the net.

Indices shift as you splice. Read the array again between structural edits
rather than reusing stale indices.

### Code surfaces

Each is a string field holding an ES module. Exact shapes:

lambdaCode: export default Lambda((input, parameters) => ...). input.PlaceName
is a tuple sized to the input arc weight; tokens are objects keyed by colour
element name. Inhibitor arcs and uncoloured input places are NOT in input. A
"predicate" lambda returns a boolean; a "stochastic" one returns a non-negative
firing rate per simulation second (0 never fires, Infinity always does). Must be
deterministic.

transitionKernelCode: export default TransitionKernel((input, parameters) =>
...). Returns an object keyed by OUTPUT place name whose values are arrays of
tokens sized to the output arc weight. Only coloured output places need
entries; uncoloured ones fill themselves. Always required — use () => ({}) when
there is nothing to produce. Distribution.Gaussian(mean, sd),
Distribution.Uniform(min, max) and Distribution.Lognormal(mu, sigma) are in
scope for stochastic attributes.

differentialEquations[].code: export default Dynamics((tokens, parameters) =>
...). tokens is only THIS place's tokens. Return an array of the same length of
objects giving the DERIVATIVE (dx/dt) per colour element, not the new value.
The equation's colorId must match the colorId of every place using it.

places[].visualizerCode: export default Visualization(({ tokens, parameters })
=> <svg viewBox="0 0 W H">...</svg>). Classic React runtime — do NOT import
React, do NOT use fragments, do NOT use hooks.

metrics[].code: a plain function body, NOT a module — no export, no wrapper.
Only "state" is in scope; parameters and scenario are not. Must return a finite
number. Example: return state.places.Infected.count;

### Worked example — two places and one stochastic transition

Places "Susceptible" (x 100, y 100) and "Infected" (x 400, y 100), both with
colorId null and dynamicsEnabled false. One transition "infection" at x 250,
y 100 with inputArcs [{ placeId: <Susceptible>, weight: 1, type: "standard" }],
outputArcs [{ placeId: <Infected>, weight: 1 }], lambdaType "stochastic",
lambdaCode "export default Lambda((input, parameters) =>
parameters.infection_rate)", transitionKernelCode "export default
TransitionKernel(() => ({}))", plus a parameter with variableName
"infection_rate" and defaultValue "0.3".

### Workflow

1. read_doc the focused document to see the current net and array lengths.
2. For anything beyond a trivial tweak, agree the structure first: which
   places, which transitions, and whether firing is rate-based (stochastic) or
   conditional (predicate). Say what you assumed rather than asking a long list
   of questions; offer to pick sensible values and proceed.
3. Add colours and parameters BEFORE the places and transitions that reference
   them, so the ids exist.
4. Apply edits with automerge_op, re-reading indices between structural changes.
5. read_doc to verify, then explain the modelling choices — the user can
   already see the nodes, so describe why the net behaves as it does.
`.trim();

export const skill = {
	instructions: INSTRUCTIONS,
};
