---
name: petrinaut
description: Read and write a Petri net (SDCPN) document by Automerge URL. Use when creating, editing, or querying Petri nets — adding or removing places, transitions, arcs, color types, differential equations, and parameters.
---

# Petrinaut Skill

Read and write a Stochastic Dynamic Coloured Petri Net (SDCPN) document. Supports individual element operations, batch modifications, and cascading deletes.

## Top-level API

| Method | Description |
| --- | --- |
| `await createPetriNet(title?)` | Create a new empty Petri net document. Returns `{ handle, url }`. |
| `await getPetriNet(url)` | Get a read/write interface for an existing Petri net document. |

## Types

```typescript
// Place — a state/location in the net (drawn as a circle)
{
  id: string,           // UUID, auto-generated
  name: string,
  colorId: string|null, // references a Color by id
  dynamicsEnabled: boolean,
  differentialEquationId: string|null,
  x: number,
  y: number,
  visualizerCode?: string  // custom SVG/JSX rendering function
}

// Transition — a transformation/event in the net (drawn as a rectangle)
{
  id: string,           // UUID, auto-generated
  name: string,
  inputArcs: Arc[],     // required, arcs from places into this transition (pass [] if none)
  outputArcs: Arc[],    // required, arcs from this transition to places (pass [] if none)
  lambdaType: "predicate" | "stochastic",
  lambdaCode: string,   // firing-condition function body
  transitionKernelCode: string,  // output-token colouring function body
  x: number,
  y: number
}

// Arc — connects a place to a transition (or vice versa)
{
  placeId: string,      // references a Place by id
  weight: number        // number of tokens consumed/produced (>= 1)
}

// Color (Type) — defines token structure for places
{
  id: string,
  name: string,
  iconSlug: string,     // e.g. "circle"
  displayColor: string, // hex code, e.g. "#3498db"
  elements: ColorElement[]
}

// ColorElement — a dimension/field of a Color
{
  elementId: string,
  name: string,
  type: "real" | "integer" | "boolean"
}

// DifferentialEquation — continuous dynamics for a color type
{
  id: string,
  name: string,
  colorId: string,      // references a Color by id
  code: string          // dynamics function body
}

// Parameter — a global parameter accessible in all code blocks
{
  id: string,
  name: string,
  variableName: string, // identifier used in code, e.g. "alpha"
  type: "real" | "integer" | "boolean",
  defaultValue: string
}
```

## Petri net object

Returned by `getPetriNet(url)`. All read methods are synchronous; all write methods are synchronous (they mutate the Automerge document in place).

| Method | Description |
| --- | --- |
| `url` | The Automerge URL of the backing document. |
| `getPlaces()` | Returns all places as `Place[]`. |
| `getTransitions()` | Returns all transitions as `Transition[]`. |
| `getArcs()` | Returns all arcs as flat list with `{ id, direction, placeId, transitionId, weight }`. |
| `getColors()` | Returns all color types as `Color[]`. |
| `getDifferentialEquations()` | Returns all differential equations. |
| `getParameters()` | Returns all global parameters. |
| `getTitle()` | Returns the document title. |
| `addPlace(args)` | Add a place. Returns the created Place. |
| `addTransition(args)` | Add a transition. `inputArcs` and `outputArcs` are required (use `[]` if none). Returns the created Transition. |
| `addArc(args)` | Add an arc between a place and a transition. |
| `addColor(args)` | Add a color/type definition. Returns the created Color. |
| `addDifferentialEquation(args)` | Add a differential equation. Returns the created equation. |
| `addParameter(args)` | Add a global parameter. Returns the created Parameter. |
| `setTitle(title)` | Set the document title. |
| `removeItems(items)` | Cascading delete — see Remove Items below. |
| `modifyNetElements({ add, remove })` | Batch add and/or remove in a single transaction. |

## Method Details

### `createPetriNet(title?)`

```javascript
const { handle, url } = await createPetriNet("SIR Model");
```

### `getPetriNet(url)`

```javascript
const net = await getPetriNet(url);
const places = net.getPlaces();
```

### `addPlace(args)`

```javascript
net.addPlace({
  name: "Susceptible",         // required
  x: 200,                      // optional, defaults to 100
  y: 150,                      // optional, defaults to 100
  colorId: "<color-uuid>",     // optional, null if untyped
  dynamicsEnabled: false,      // optional, defaults to false
  differentialEquationId: null, // optional
  visualizerCode: "..."        // optional, custom SVG renderer
});
```

The `visualizerCode` is a function that receives `{ tokens, parameters }` and returns JSX/SVG:

```javascript
export default Visualization(({ tokens, parameters }) => {
  return <svg>
    <circle cx="50" cy="50" r="40" stroke="black" strokeWidth="3" fill="red" />
  </svg>
});
```

### `addTransition(args)`

```javascript
net.addTransition({
  name: "Infect",              // required
  inputArcs: [                 // required, arcs from places into this transition (use [] if none)
    { placeId: "<place-uuid>", weight: 1 }
  ],
  outputArcs: [                // required, arcs from this transition to places (use [] if none)
    { placeId: "<place-uuid>", weight: 1 }
  ],
  x: 300,                      // optional, defaults to 100
  y: 150,                      // optional, defaults to 100
  lambdaType: "stochastic",   // optional: "predicate" (default) or "stochastic"
  lambdaCode: "...",           // optional, firing condition function
  transitionKernelCode: "...", // optional, output token colouring function
});
```

**Lambda code** receives `(tokensByPlace, parameters)`:

```javascript
export default Lambda((tokensByPlace, parameters) => {
  // tokensByPlace: { PlaceName: [{ dim1: val, dim2: val }, ...], ... }
  // Return boolean (predicate) or number (stochastic rate per second)
  return true;
});
```

**Transition kernel code** receives `(tokensByPlace, parameters)`:

```javascript
export default TransitionKernel((tokensByPlace, parameters) => {
  return {
    OutputPlaceName: [{ x: 0, y: 0 }],
  };
});
```

### `addArc(args)`

Arcs are directional. Use `direction` to specify the type:

```javascript
// Place -> Transition (input arc)
net.addArc({
  direction: "place_to_transition",
  source_place: "Susceptible",      // name or id
  target_transition: "Infect",      // name or id
  weight: 1                         // optional, defaults to 1
});

// Transition -> Place (output arc)
net.addArc({
  direction: "transition_to_place",
  source_transition: "Infect",
  target_place: "Infected",
  weight: 1
});
```

### `addColor(args)`

```javascript
net.addColor({
  name: "Person",                   // required
  displayColor: "#3498db",          // required, hex code
  iconSlug: "circle",               // optional, defaults to "circle"
  elements: [                       // optional
    { name: "age", type: "integer" },
    { name: "infected", type: "boolean" }
  ]
});
```

### `addDifferentialEquation(args)`

```javascript
net.addDifferentialEquation({
  name: "Decay",                    // required
  colorId: "<color-uuid>",         // required
  code: "..."                       // required, dynamics function body
});
```

The code receives `(tokens, parameters)` and returns derivatives:

```javascript
export default Dynamics((tokens, parameters) => {
  return tokens.map((token) => ({
    [token.property]: token.value * parameters.alpha,
  }));
});
```

### `addParameter(args)`

```javascript
net.addParameter({
  name: "Infection Rate",           // required, display name
  variableName: "beta",             // required, used in code
  type: "real",                     // "real" | "integer" | "boolean"
  defaultValue: "0.3"              // required, as string
});
```

### `removeItems(items)`

Cascading delete. Removing a place also removes all arcs touching it. Removing a color type clears `colorId` on places that reference it. Removing a differential equation clears `differentialEquationId` on places that reference it.

```javascript
net.removeItems([
  { type: "place", id: "<uuid>" },
  { type: "transition", id: "<uuid>" },
  { type: "arc", id: "$A_<sourceId>___<targetId>" },
  { type: "type", id: "<uuid>" },
  { type: "differentialEquation", id: "<uuid>" },
  { type: "parameter", id: "<uuid>" }
]);
```

Arc IDs follow the format `$A_<sourceId>___<targetId>` where source is the place id for input arcs (place -> transition) and the transition id for output arcs (transition -> place).

### `modifyNetElements({ add, remove })`

Batch operation. Removals run first, then additions — so you can replace subgraphs in one call. Arcs in the `add.arcs` array can reference places/transitions created in the same batch by name.

```javascript
net.modifyNetElements({
  remove: [
    { type: "place", id: "<uuid>" }
  ],
  add: {
    places: [
      { name: "A", x: 100, y: 100 },
      { name: "B", x: 300, y: 100 }
    ],
    transitions: [
      { name: "T1", x: 200, y: 100, inputArcs: [], outputArcs: [] }
    ],
    arcs: [
      { direction: "place_to_transition", source_place: "A", target_transition: "T1" },
      { direction: "transition_to_place", source_transition: "T1", target_place: "B" }
    ]
  }
});
```

## Examples

### Create an SIR epidemiological model

```javascript
const { handle, url } = await createPetriNet("SIR Model");
const net = await getPetriNet(url);

// Add parameters
net.addParameter({
  name: "Infection Rate",
  variableName: "beta",
  type: "real",
  defaultValue: "0.3"
});

net.addParameter({
  name: "Recovery Rate",
  variableName: "gamma",
  type: "real",
  defaultValue: "0.1"
});

// Build the net structure in one batch
net.modifyNetElements({
  add: {
    places: [
      { name: "Susceptible", x: 100, y: 200 },
      { name: "Infected", x: 300, y: 200 },
      { name: "Recovered", x: 500, y: 200 }
    ],
    transitions: [
      {
        name: "Infect",
        x: 200, y: 200,
        inputArcs: [], outputArcs: [],
        lambdaType: "stochastic",
        lambdaCode: `export default Lambda((tokens, params) => params.beta);`
      },
      {
        name: "Recover",
        x: 400, y: 200,
        inputArcs: [], outputArcs: [],
        lambdaType: "stochastic",
        lambdaCode: `export default Lambda((tokens, params) => params.gamma);`
      }
    ],
    arcs: [
      { direction: "place_to_transition", source_place: "Susceptible", target_transition: "Infect" },
      { direction: "place_to_transition", source_place: "Infected", target_transition: "Infect", weight: 1 },
      { direction: "transition_to_place", source_transition: "Infect", target_place: "Infected", weight: 2 },
      { direction: "place_to_transition", source_place: "Infected", target_transition: "Recover" },
      { direction: "transition_to_place", source_transition: "Recover", target_place: "Recovered" }
    ]
  }
});
```

### Query and modify an existing net

```javascript
const net = await getPetriNet(url);

// Read current state
const places = net.getPlaces();
const transitions = net.getTransitions();
const arcs = net.getArcs();
const colors = net.getColors();
const params = net.getParameters();

console.log(`Net has ${places.length} places, ${transitions.length} transitions`);

// Add a new place connected to an existing transition
const place = net.addPlace({ name: "Vaccinated", x: 300, y: 400 });
net.addArc({
  direction: "transition_to_place",
  source_transition: "Vaccinate",
  target_place: place.name,
});

// Remove elements
net.removeItems([
  { type: "place", id: places[0].id }
]);
```

## Notes

- `addArc` resolves places and transitions by **name or id** — use whichever is convenient.
- In `modifyNetElements`, arcs in `add.arcs` resolve against both newly created elements (by name) and pre-existing ones.
- Arc IDs use the format `$A_<sourceId>___<targetId>` (three underscores). For a place-to-transition arc, sourceId is the place, targetId is the transition; vice versa for transition-to-place.
- Positions (`x`, `y`) default to 100 if omitted. Use the positions to lay out the net spatially — place elements on a grid or follow a flow direction (left-to-right, top-to-bottom).
