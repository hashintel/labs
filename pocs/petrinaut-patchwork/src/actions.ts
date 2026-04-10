/**
 * @todo Needs rewriting from acitons to new Patchwork skills approach.
 * @see https://github.com/inkandswitch/patchwork-tools/tree/main/llm/skills
 */

import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type {
	Color,
	DifferentialEquation,
	Parameter,
	Place,
	SDCPN,
	Transition,
} from "@hashintel/petrinaut";
import { z } from "zod";
import type { Doc } from "./datatype";

import { v4 as generateUuid } from "uuid";

/** Arc id format used by Petrinaut ($A_<inputId>___<outputId>). */
const ARC_ID_PREFIX = "$A_" as const;
const ARC_ID_SEPARATOR = "___" as const;

function generateArcId({
	inputId,
	outputId,
}: {
	inputId: string;
	outputId: string;
}) {
	return `${ARC_ID_PREFIX}${inputId}${ARC_ID_SEPARATOR}${outputId}`;
}

export type NetRemoveItem =
	| { type: "place"; id: string }
	| { type: "transition"; id: string }
	| { type: "arc"; id: string }
	| { type: "type"; id: string }
	| { type: "differentialEquation"; id: string }
	| { type: "parameter"; id: string };

/**
 * Same deletion semantics as Petrinaut's deleteItemsByIds (mutation-provider):
 * cascades arc removal when places/transitions disappear; clears dangling refs for types/equations.
 */
export function deleteItemsFromSdcpn(sdcpn: SDCPN, items: NetRemoveItem[]) {
	if (items.length === 0) {
		return;
	}

	const placeIds = new Set<string>();
	const transitionIds = new Set<string>();
	const arcIds = new Set<string>();
	const typeIds = new Set<string>();
	const equationIds = new Set<string>();
	const parameterIds = new Set<string>();

	for (const item of items) {
		switch (item.type) {
			case "place":
				placeIds.add(item.id);
				break;
			case "transition":
				transitionIds.add(item.id);
				break;
			case "arc":
				arcIds.add(item.id);
				break;
			case "type":
				typeIds.add(item.id);
				break;
			case "differentialEquation":
				equationIds.add(item.id);
				break;
			case "parameter":
				parameterIds.add(item.id);
				break;
		}
	}

	const hasCanvasDeletes =
		placeIds.size > 0 || transitionIds.size > 0 || arcIds.size > 0;

	if (hasCanvasDeletes) {
		for (let i = sdcpn.transitions.length - 1; i >= 0; i--) {
			const transition = sdcpn.transitions[i];
			if (!transition) {
				continue;
			}
			if (transitionIds.has(transition.id)) {
				sdcpn.transitions.splice(i, 1);
				continue;
			}

			for (
				let inputArcIndex = transition.inputArcs.length - 1;
				inputArcIndex >= 0;
				inputArcIndex--
			) {
				const inputArc = transition.inputArcs[inputArcIndex];
				if (!inputArc) {
					continue;
				}
				const arcId = generateArcId({
					inputId: inputArc.placeId,
					outputId: transition.id,
				});

				if (arcIds.has(arcId) || placeIds.has(inputArc.placeId)) {
					transition.inputArcs.splice(inputArcIndex, 1);
				}
			}

			for (
				let outputArcIndex = transition.outputArcs.length - 1;
				outputArcIndex >= 0;
				outputArcIndex--
			) {
				const outputArc = transition.outputArcs[outputArcIndex];
				if (!outputArc) {
					continue;
				}
				const arcId = generateArcId({
					inputId: transition.id,
					outputId: outputArc.placeId,
				});

				if (arcIds.has(arcId) || placeIds.has(outputArc.placeId)) {
					transition.outputArcs.splice(outputArcIndex, 1);
				}
			}
		}

		for (let i = sdcpn.places.length - 1; i >= 0; i--) {
			const place = sdcpn.places[i];
			if (place && placeIds.has(place.id)) {
				sdcpn.places.splice(i, 1);
			}
		}
	}

	if (typeIds.size > 0) {
		for (let i = sdcpn.types.length - 1; i >= 0; i--) {
			const color = sdcpn.types[i];
			if (color && typeIds.has(color.id)) {
				sdcpn.types.splice(i, 1);
			}
		}
		for (const place of sdcpn.places) {
			if (place.colorId && typeIds.has(place.colorId)) {
				place.colorId = null;
			}
		}
		for (const equation of sdcpn.differentialEquations) {
			if (typeIds.has(equation.colorId)) {
				equation.colorId = "";
			}
		}
	}

	if (equationIds.size > 0) {
		for (let i = sdcpn.differentialEquations.length - 1; i >= 0; i--) {
			const equation = sdcpn.differentialEquations[i];
			if (equation && equationIds.has(equation.id)) {
				sdcpn.differentialEquations.splice(i, 1);
			}
		}
		for (const place of sdcpn.places) {
			if (
				place.differentialEquationId &&
				equationIds.has(place.differentialEquationId)
			) {
				place.differentialEquationId = null;
			}
		}
	}

	if (parameterIds.size > 0) {
		for (let i = sdcpn.parameters.length - 1; i >= 0; i--) {
			const parameter = sdcpn.parameters[i];
			if (parameter && parameterIds.has(parameter.id)) {
				sdcpn.parameters.splice(i, 1);
			}
		}
	}
}

// ============================================================================
// Helper functions to query document state
// ============================================================================

const getPlaces = (doc: Doc): Place[] => {
	return doc.petriNetDefinition.places;
};

const getTransitions = (doc: Doc): Transition[] => {
	return doc.petriNetDefinition.transitions;
};

const getColors = (doc: Doc): Color[] => {
	return doc.petriNetDefinition.types || [];
};

const getDifferentialEquations = (doc: Doc): DifferentialEquation[] => {
	return doc.petriNetDefinition.differentialEquations;
};

const getGlobalParameters = (doc: Doc) => {
	return doc.petriNetDefinition.parameters;
};

// ============================================================================
// Action: Add Place
// ============================================================================

export const getPlaceBaseSchema = (doc: Doc) => {
	const colors = getColors(doc);
	const differentialEquations = getDifferentialEquations(doc);

	const colorIds = colors.map((c) => c.id);
	const diffEqIds = differentialEquations.map((de) => de.id);

	const globalParameters = getGlobalParameters(doc);

	const baseSchema: Record<string, z.ZodTypeAny> = {
		name: z.string().describe("Name for the place"),
		x: z.number().optional().describe("X position (defaults to 100)"),
		y: z.number().optional().describe("Y position (defaults to 100)"),
		colorId:
			colorIds.length > 0
				? z
						.enum(colorIds as [string, ...string[]])
						.optional()
						.describe("Color/type ID for the place")
				: z.null().optional().describe("No colors are defined in the net"),
		dynamicsEnabled: z
			.boolean()
			.optional()
			.describe(
				"Whether the place should have dynamics enabled (governed by differential equation) (defaults to false)",
			),
		differentialEquationId:
			diffEqIds.length > 0
				? z
						.enum(diffEqIds as [string, ...string[]])
						.optional()
						.describe("ID for the differential equation governing dynamics")
				: z
						.null()
						.optional()
						.describe("No differential equations are defined in the net"),
		visualizerCode: z
			.string()
			.optional()
			.describe(`Custom visualizer code for the place.
This function defines how to visualize the tokens in the place.
It receives an object with the following properties:
- tokens: An array of tokens in the place, each of which is an object with the properties defined by the color/type associated with the place.
- parameters: An object containing the global parameters defined in the net, currently: ${globalParameters.map((p) => `${p.name} (${p.type})`).join(", ")}.

/** Example */
export default Visualization(({ tokens, parameters }) => {
  return <svg>
    <circle cx="50" cy="50" r="40" stroke="black" strokeWidth="3" fill="red" />
  </svg>
});
`),
	};

	return baseSchema;
};

export const addPlaceArgsSchema = (doc: Doc) => {
	return z.object(getPlaceBaseSchema(doc));
};

export async function addPlace(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		name: string;
		colorId?: string;
		x?: number;
		y?: number;
		dynamicsEnabled?: boolean;
		differentialEquationId?: string;
		visualizerCode?: string;
	},
) {
	handle.change((doc) => {
		const newPlace: Place = {
			id: generateUuid(),
			name: args.name,
			colorId: args.colorId ?? null,
			dynamicsEnabled: args.dynamicsEnabled ?? false,
			differentialEquationId: args.differentialEquationId ?? null,
			x: args.x ?? 100,
			y: args.y ?? 100,
			visualizerCode: args.visualizerCode,
		};

		doc.petriNetDefinition.places.push(newPlace);
	});
}

// ============================================================================
// Action: Add Transition
// ============================================================================

const getTransitionBaseSchema = (doc: Doc) => {
	const globalParameters = getGlobalParameters(doc);

	const placeOptions = getPlaces(doc).map((p) => ({
		id: p.id,
		name: p.name,
	}));

	return {
		name: z.string().describe("Name for the transition"),
		x: z.number().optional().describe("X position (defaults to 100)"),
		y: z.number().optional().describe("Y position (defaults to 100)"),
		lambdaType: z
			.enum(["predicate", "stochastic"])
			.optional()
			.describe(`Type of lambda function (defaults to 'predicate').
Lambda functions are used to determine whether/when a transition should fire.
- Predicate: A function that returns a boolean value.
- Stochastic: A function that returns a firing rate per second.`),
		lambdaCode: z
			.string()
			.optional()
			.describe(`Lambda code for the transition (defaults to empty string).

The lambda function receives two arguments:
- tokens: An object keyed by the name of input places to the transition, with the value being an array of input token(s) from that place (n = arc weight).
- parameters: An object containing the global parameters defined in the net, currently: ${globalParameters.map((p) => `${p.name} (${p.type})`).join(", ")}.

Example:
export default Lambda((tokensByPlace, parameters) => {
  // tokensByPlace is an object which looks like:
  //   { PlaceA: [{ x: 0, y: 0 }], PlaceB: [...] }
  // where 'x' and 'y' are examples of dimensions (properties)
  // of the token's type.

  // When defining a predicate check,
  // return a boolean (true = enabled, false = disabled).
  //
  // When defining a stochastic firing rate, return a number:
  //  1. 0 means disabled
  //  2. Infinity means always enabled
  //  3. Any other number is the average rate per second

  return true; // or a number between 0 and Infinity if the lambdaType is 'stochastic'
});
`),
		transitionKernelCode: z
			.string()
			.optional()
			.describe(
				`Transition kernel code for the transition (defaults to empty string).

This determines the colouring of tokens in output places after the transition fires, optionally based on input tokens and global parameters.

The transition kernel function receives the following arguments:
- tokensByPlace: An object keyed by the name of output places to the transition, with the value being an array of output token(s) to that place (n = arc weight).
- parameters: An object containing the global parameters defined in the net, currently: ${globalParameters.map((p) => `${p.name} (${p.type})`).join(", ")}.

Example where the transition is connected to two output places, PlaceA and PlaceB, both coloured by a type with two dimensions, x and  y.
export default TransitionKernel((tokensByPlace, parameters) => {
  return {
    PlaceA: [{ x: 0, y: 0 }],
    PlaceB: [{ x: 1, y: 1 }],
  };
});

        `,
			),
		inputArcs: z
			.array(
				z.object({
					placeId: z.string().describe("ID of the place"),
					weight: z
						.number()
						.min(1)
						.optional()
						.describe("Arc weight (defaults to 1)"),
				}),
			)
			.optional()
			.describe(
				`Input arcs for the transition. Available place ids: ${placeOptions.map((p) => `${p.id} (${p.name})`).join(", ")}`,
			),
		outputArcs: z
			.array(
				z.object({
					placeId: z.string().describe("ID of the place"),
					weight: z
						.number()
						.min(1)
						.optional()
						.describe("Arc weight (defaults to 1)"),
				}),
			)
			.optional()
			.describe(
				`Output arcs for the transition. Available place ids: ${placeOptions.map((p) => `${p.id} (${p.name})`).join(", ")}`,
			),
	};
};

export const addTransitionArgsSchema = (doc: Doc) => {
	return z.object(getTransitionBaseSchema(doc));
};

export async function addTransition(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		name: string;
		x?: number;
		y?: number;
		lambdaType?: "predicate" | "stochastic";
		lambdaCode?: string;
		transitionKernelCode?: string;
		inputArcs?: Transition["inputArcs"];
		outputArcs?: Transition["outputArcs"];
	},
) {
	handle.change((doc) => {
		const newTransition: Transition = {
			id: generateUuid(),
			name: args.name,
			inputArcs: args.inputArcs ?? [],
			outputArcs: args.outputArcs ?? [],
			lambdaType: args.lambdaType ?? "predicate",
			lambdaCode: args.lambdaCode ?? "",
			transitionKernelCode: args.transitionKernelCode ?? "",
			x: args.x ?? 100,
			y: args.y ?? 100,
		};

		doc.petriNetDefinition.transitions.push(newTransition);
	});
}

// ============================================================================
// Action: Add Arc
// ============================================================================

export const addArcArgsSchema = (doc: Doc) => {
	const places = getPlaces(doc);
	const transitions = getTransitions(doc);

	const placeOptions = places.map((p) => p.name || p.id);
	const transitionOptions = transitions.map((t) => t.name || t.id);

	// Schema for place -> transition arcs (input arcs)
	const placeToTransitionSchema = z.object({
		direction: z.literal("place_to_transition"),
		source_place:
			placeOptions.length > 0
				? z
						.enum(placeOptions as [string, ...string[]])
						.describe("Source place (name or ID)")
				: z.string().describe("Source place (no places available yet)"),
		target_transition:
			transitionOptions.length > 0
				? z
						.enum(transitionOptions as [string, ...string[]])
						.describe("Target transition (name or ID)")
				: z
						.string()
						.describe("Target transition (no transitions available yet)"),
		weight: z.number().min(1).optional().describe("Arc weight (defaults to 1)"),
	});

	// Schema for transition -> place arcs (output arcs)
	const transitionToPlaceSchema = z.object({
		direction: z.literal("transition_to_place"),
		source_transition:
			transitionOptions.length > 0
				? z
						.enum(transitionOptions as [string, ...string[]])
						.describe("Source transition (name or ID)")
				: z
						.string()
						.describe("Source transition (no transitions available yet)"),
		target_place:
			placeOptions.length > 0
				? z
						.enum(placeOptions as [string, ...string[]])
						.describe("Target place (name or ID)")
				: z.string().describe("Target place (no places available yet)"),
		weight: z.number().min(1).optional().describe("Arc weight (defaults to 1)"),
	});

	return z.discriminatedUnion("direction", [
		placeToTransitionSchema,
		transitionToPlaceSchema,
	]);
};

type AddArcArgs =
	| {
			direction: "place_to_transition";
			source_place: string;
			target_transition: string;
			weight?: number;
	  }
	| {
			direction: "transition_to_place";
			source_transition: string;
			target_place: string;
			weight?: number;
	  };

export async function addArc(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: AddArcArgs,
) {
	handle.change((doc) => {
		const places = getPlaces(doc);
		const transitions = getTransitions(doc);

		if (args.direction === "place_to_transition") {
			// Find the source place
			const sourcePlace = places.find(
				(p) => p.name === args.source_place || p.id === args.source_place,
			);
			if (!sourcePlace) {
				throw new Error(`Place "${args.source_place}" not found`);
			}

			// Find the target transition
			const targetTransition = transitions.find(
				(t) =>
					t.name === args.target_transition || t.id === args.target_transition,
			);
			if (!targetTransition) {
				throw new Error(`Transition "${args.target_transition}" not found`);
			}

			// Add input arc to the transition
			targetTransition.inputArcs.push({
				placeId: sourcePlace.id,
				weight: args.weight ?? 1,
			});
		} else {
			// Find the source transition
			const sourceTransition = transitions.find(
				(t) =>
					t.name === args.source_transition || t.id === args.source_transition,
			);
			if (!sourceTransition) {
				throw new Error(`Transition "${args.source_transition}" not found`);
			}

			// Find the target place
			const targetPlace = places.find(
				(p) => p.name === args.target_place || p.id === args.target_place,
			);
			if (!targetPlace) {
				throw new Error(`Place "${args.target_place}" not found`);
			}

			// Add output arc to the transition
			sourceTransition.outputArcs.push({
				placeId: targetPlace.id,
				weight: args.weight ?? 1,
			});
		}
	});
}

// ============================================================================
// Action: Add Color (Type)
// ============================================================================

export const addColorArgsSchema = () => {
	return z.object({
		name: z.string().describe("Name of the color/type"),
		iconSlug: z
			.string()
			.optional()
			.describe("Icon slug for the color (defaults to 'circle')"),
		displayColor: z
			.string()
			.regex(/^#[0-9A-Fa-f]{6}$/)
			.describe("Display color as hex code (e.g., #3498db)"),
		elements: z
			.array(
				z.object({
					name: z.string().describe("Name of the element"),
					type: z
						.enum(["real", "integer", "boolean"])
						.describe("Type of the element"),
				}),
			)
			.optional()
			.describe("Elements/fields for this color type"),
	});
};

export async function addColor(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		name: string;
		iconSlug?: string;
		displayColor: string;
		elements?: { name: string; type: "real" | "integer" | "boolean" }[];
	},
) {
	handle.change((doc) => {
		const newColor: Color = {
			id: generateUuid(),
			name: args.name,
			iconSlug: args.iconSlug ?? "circle",
			displayColor: args.displayColor,
			elements: (args.elements ?? []).map((el) => ({
				elementId: generateUuid(),
				name: el.name,
				type: el.type,
			})),
		};

		doc.petriNetDefinition.types.push(newColor);
	});
}

// ============================================================================
// Action: Add Differential Equation
// ============================================================================

export const addDifferentialEquationArgsSchema = (doc: Doc) => {
	const colors = getColors(doc);
	const colorIds = colors.map((c) => c.id);
	const globalParameters = getGlobalParameters(doc);

	return z.object({
		name: z.string().describe("Name for the differential equation"),
		colorId:
			colorIds.length > 0
				? z
						.enum(colorIds as [string, ...string[]])
						.describe("Color/type ID this equation applies to")
				: z.null().optional().describe("No colors are defined in the net"),
		code: z
			.string()
			.describe(`The differential equation code (mathematical expression).

The differential equation function receives the following arguments:
- tokens: An array of input tokens, each of which is an object with the properties defined by the associated color/type.
- parameters: An object containing the global parameters defined in the net, currently: ${globalParameters.map((p) => `${p.name} (${p.type})`).join(", ")}.

It should return the derivative of each token's property value.

Example:
export default Dynamics((tokens, parameters) => {
  return tokens.map((token) => {
    return {
      [token.property]: token.value * parameters.alpha,
    };
  });
});
`),
	});
};

export async function addDifferentialEquation(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		name: string;
		colorId: string;
		code: string;
	},
) {
	handle.change((doc) => {
		const newDiffEq: DifferentialEquation = {
			id: generateUuid(),
			name: args.name,
			colorId: args.colorId,
			code: args.code,
		};

		doc.petriNetDefinition.differentialEquations.push(newDiffEq);
	});
}

// ============================================================================
// Action: Add Parameter
// ============================================================================

export const addParameterArgsSchema = () => {
	return z.object({
		name: z.string().describe("Display name for the parameter"),
		variableName: z
			.string()
			.describe("Variable name to use in code (e.g., 'alpha', 'beta')"),
		type: z
			.enum(["real", "integer", "boolean"])
			.describe("Type of the parameter"),
		defaultValue: z
			.string()
			.describe("Default value for the parameter (as string)"),
	});
};

export async function addParameter(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		name: string;
		variableName: string;
		type: "real" | "integer" | "boolean";
		defaultValue: string;
	},
) {
	handle.change((doc) => {
		const newParameter: Parameter = {
			id: generateUuid(),
			name: args.name,
			variableName: args.variableName,
			type: args.type,
			defaultValue: args.defaultValue,
		};

		doc.petriNetDefinition.parameters.push(newParameter);
	});
}

// ============================================================================
// Action: Modify Net Elements (batch add / remove)
// ============================================================================

const netRemoveItemSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("place"),
		id: z.string().describe("Place id (uuid)"),
	}),
	z.object({
		type: z.literal("transition"),
		id: z.string().describe("Transition id (uuid)"),
	}),
	z.object({
		type: z.literal("arc"),
		id: z
			.string()
			.describe(
				`Arc id: $A_<sourceId>___<targetId> where source is place id for input arcs and transition id for output arcs (same format as the editor). Example input arc from place p1 to transition t1: ${ARC_ID_PREFIX}p1${ARC_ID_SEPARATOR}t1.`,
			),
	}),
	z.object({
		type: z.literal("type"),
		id: z
			.string()
			.describe(
				"Color/type id (uuid); removes the type and clears place color refs",
			),
	}),
	z.object({
		type: z.literal("differentialEquation"),
		id: z.string().describe("Differential equation id (uuid)"),
	}),
	z.object({
		type: z.literal("parameter"),
		id: z.string().describe("Global parameter id (uuid)"),
	}),
]);

export const modifyNetElementsArgsSchema = (doc: Doc) => {
	const placeBaseSchema = getPlaceBaseSchema(doc);
	const placeSchema = z.object(placeBaseSchema);

	const transitionBaseSchema = getTransitionBaseSchema(doc);
	const transitionSchema = z.object(transitionBaseSchema);

	const arcSchema = z.discriminatedUnion("direction", [
		z.object({
			direction: z.literal("place_to_transition"),
			source_place: z.string().describe("Source place name or id"),
			target_transition: z.string().describe("Target transition name or id"),
			weight: z
				.number()
				.min(1)
				.optional()
				.describe("Arc weight (defaults to 1)"),
		}),
		z.object({
			direction: z.literal("transition_to_place"),
			source_transition: z.string().describe("Source transition name or id"),
			target_place: z.string().describe("Target place name or id"),
			weight: z
				.number()
				.min(1)
				.optional()
				.describe("Arc weight (defaults to 1)"),
		}),
	]);

	const addSchema = z
		.object({
			places: z.array(placeSchema).optional().describe("Places to create"),
			transitions: z
				.array(transitionSchema)
				.optional()
				.describe(
					"Transitions to create (inputArcs/outputArcs here are honored; you can also list arcs separately).",
				),
			arcs: z
				.array(arcSchema)
				.optional()
				.describe(
					"Arcs after places/transitions in this add block are created; resolves names from this batch then existing net.",
				),
		})
		.optional()
		.describe(`Batch-create graph elements.

Example — simple pipeline:
{ "places": [{ "name": "A" }, { "name": "B" }],
  "transitions": [{ "name": "T" }],
  "arcs": [
    { "direction": "place_to_transition", "source_place": "A", "target_transition": "T" },
    { "direction": "transition_to_place", "source_transition": "T", "target_place": "B" }
  ]
}

Example — transition with arcs inline (same net):
{ "transitions": [{
    "name": "Fire",
    "inputArcs": [{ "placeId": "<existing-place-uuid>", "weight": 1 }],
    "outputArcs": [{ "placeId": "<other-place-uuid>", "weight": 1 }]
}]}`);

	return z
		.object({
			add: addSchema,
			remove: z
				.array(netRemoveItemSchema)
				.optional()
				.describe(`Remove items by id, using the same rules as the Petrinaut editor (arcs touching a deleted place are removed; deleting a transition removes all its arcs).

Examples:
- Remove one place: [{ "type": "place", "id": "<uuid>" }]
- Remove a transition: [{ "type": "transition", "id": "<uuid>" }]
- Remove one arc only: [{ "type": "arc", "id": "$A_<placeId>___<transitionId>" }] for place→transition, or id "$A_<transitionId>___<placeId>" for transition→place
- Remove a color type: [{ "type": "type", "id": "<uuid>" }] (places keep running but colorId is cleared)`),
		})
		.describe(
			"Apply batched structural edits. Removals run first, then additions (so you can replace subgraphs in one call). Either add or remove (or both) should be non-empty.",
		);
};

type ModifyNetElementsAdd = {
	places?: Array<{
		name: string;
		colorId?: string;
		x?: number;
		y?: number;
		dynamicsEnabled?: boolean;
		differentialEquationId?: string;
		visualizerCode?: string;
	}>;
	transitions?: Array<{
		name: string;
		x?: number;
		y?: number;
		lambdaType?: "predicate" | "stochastic";
		lambdaCode?: string;
		transitionKernelCode?: string;
		inputArcs?: Transition["inputArcs"];
		outputArcs?: Transition["outputArcs"];
	}>;
	arcs?: Array<
		| {
				direction: "place_to_transition";
				source_place: string;
				target_transition: string;
				weight?: number;
		  }
		| {
				direction: "transition_to_place";
				source_transition: string;
				target_place: string;
				weight?: number;
		  }
	>;
};

export type ModifyNetElementsArgs = {
	add?: ModifyNetElementsAdd;
	remove?: NetRemoveItem[];
};

export async function modifyNetElements(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: ModifyNetElementsArgs,
) {
	const placeIdMap: Map<string, string> = new Map();
	const transitionIdMap: Map<string, string> = new Map();

	handle.change((doc) => {
		const def = doc.petriNetDefinition;

		if (args.remove?.length) {
			deleteItemsFromSdcpn(def, args.remove);
		}

		if (!args.add) {
			return;
		}

		if (args.add.places) {
			for (const placeArgs of args.add.places) {
				const newPlace: Place = {
					id: generateUuid(),
					name: placeArgs.name,
					colorId: placeArgs.colorId ?? null,
					dynamicsEnabled: placeArgs.dynamicsEnabled ?? false,
					differentialEquationId: placeArgs.differentialEquationId ?? null,
					x: placeArgs.x ?? 100,
					y: placeArgs.y ?? 100,
				};

				if (placeArgs.visualizerCode) {
					newPlace.visualizerCode = placeArgs.visualizerCode;
				}

				placeIdMap.set(placeArgs.name, newPlace.id);
				def.places.push(newPlace);
			}
		}

		if (args.add.transitions) {
			for (const transitionArgs of args.add.transitions) {
				const newTransition: Transition = {
					id: generateUuid(),
					name: transitionArgs.name,
					inputArcs: transitionArgs.inputArcs ?? [],
					outputArcs: transitionArgs.outputArcs ?? [],
					lambdaType: transitionArgs.lambdaType ?? "predicate",
					lambdaCode: transitionArgs.lambdaCode ?? "",
					transitionKernelCode: transitionArgs.transitionKernelCode ?? "",
					x: transitionArgs.x ?? 100,
					y: transitionArgs.y ?? 100,
				};

				transitionIdMap.set(transitionArgs.name, newTransition.id);
				def.transitions.push(newTransition);
			}
		}

		if (args.add.arcs) {
			for (const arcArgs of args.add.arcs) {
				if (arcArgs.direction === "place_to_transition") {
					let placeId = placeIdMap.get(arcArgs.source_place);
					if (!placeId) {
						const existingPlace = def.places.find(
							(p) =>
								p.name === arcArgs.source_place ||
								p.id === arcArgs.source_place,
						);
						if (!existingPlace) {
							throw new Error(`Place "${arcArgs.source_place}" not found`);
						}
						placeId = existingPlace.id;
					}

					let transitionId = transitionIdMap.get(arcArgs.target_transition);
					if (!transitionId) {
						const existingTransition = def.transitions.find(
							(t) =>
								t.name === arcArgs.target_transition ||
								t.id === arcArgs.target_transition,
						);
						if (!existingTransition) {
							throw new Error(
								`Transition "${arcArgs.target_transition}" not found`,
							);
						}
						transitionId = existingTransition.id;
					}

					const transition = def.transitions.find((t) => t.id === transitionId);
					if (transition) {
						transition.inputArcs.push({
							placeId,
							weight: arcArgs.weight ?? 1,
						});
					}
				} else {
					let transitionId = transitionIdMap.get(arcArgs.source_transition);
					if (!transitionId) {
						const existingTransition = def.transitions.find(
							(t) =>
								t.name === arcArgs.source_transition ||
								t.id === arcArgs.source_transition,
						);
						if (!existingTransition) {
							throw new Error(
								`Transition "${arcArgs.source_transition}" not found`,
							);
						}
						transitionId = existingTransition.id;
					}

					let placeId = placeIdMap.get(arcArgs.target_place);
					if (!placeId) {
						const existingPlace = def.places.find(
							(p) =>
								p.name === arcArgs.target_place ||
								p.id === arcArgs.target_place,
						);
						if (!existingPlace) {
							throw new Error(`Place "${arcArgs.target_place}" not found`);
						}
						placeId = existingPlace.id;
					}

					const transition = def.transitions.find((t) => t.id === transitionId);
					if (transition) {
						transition.outputArcs.push({
							placeId,
							weight: arcArgs.weight ?? 1,
						});
					}
				}
			}
		}
	});
}

// ============================================================================
// Default export
// ============================================================================

export default modifyNetElements;
