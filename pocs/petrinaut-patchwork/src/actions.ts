import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type {
	Color,
	DifferentialEquation,
	Parameter,
	Place,
	Transition,
} from "@hashintel/petrinaut";
import { z } from "zod";
import type { Doc } from "./datatype";

import { v4 as generateUuid } from "uuid";

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

// ============================================================================
// Action: Add Place
// ============================================================================

export const getPlaceBaseSchema = (doc: Doc) => {
	const colors = getColors(doc);
	const differentialEquations = getDifferentialEquations(doc);

	const colorIds = colors.map((c) => c.id);
	const diffEqIds = differentialEquations.map((de) => de.id);

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
				: z.string().optional().describe("Color/type ID for the place"),
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
						.string()
						.optional()
						.describe("ID for the differential equation governing dynamics"),
		visualizerCode: z
			.string()
			.optional()
			.describe("Custom visualizer code for the place"),
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
		};

		if (args.visualizerCode) {
			newPlace.visualizerCode = args.visualizerCode;
		}

		doc.petriNetDefinition.places.push(newPlace);
	});
}

// ============================================================================
// Action: Add Transition
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getTransitionBaseSchema = (_doc: Doc) => {
	return {
		name: z.string().describe("Name for the transition"),
		x: z.number().optional().describe("X position (defaults to 100)"),
		y: z.number().optional().describe("Y position (defaults to 100)"),
		lambdaType: z
			.enum(["predicate", "stochastic"])
			.optional()
			.describe("Type of lambda function (defaults to 'predicate')"),
		lambdaCode: z
			.string()
			.optional()
			.describe("Lambda code for the transition (defaults to empty string)"),
		transitionKernelCode: z
			.string()
			.optional()
			.describe(
				"Transition kernel code for the transition (defaults to empty string)",
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
	},
) {
	handle.change((doc) => {
		const newTransition: Transition = {
			id: generateUuid(),
			name: args.name,
			inputArcs: [],
			outputArcs: [],
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const addColorArgsSchema = (_doc: Doc) => {
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

	return z.object({
		name: z.string().describe("Name for the differential equation"),
		colorId:
			colorIds.length > 0
				? z
						.enum(colorIds as [string, ...string[]])
						.describe("Color/type ID this equation applies to")
				: z.string().describe("Color/type ID this equation applies to"),
		code: z
			.string()
			.describe("The differential equation code (mathematical expression)"),
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const addParameterArgsSchema = (_doc: Doc) => {
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
// Action: Add Net Elements (batch operation)
// ============================================================================

export const addNetElementsArgsSchema = (doc: Doc) => {
	const placeBaseSchema = getPlaceBaseSchema(doc);
	const placeSchema = z.object(placeBaseSchema);

	const transitionBaseSchema = getTransitionBaseSchema(doc);
	const transitionSchema = z.object(transitionBaseSchema);

	// Simplified arc schema for batch operations - uses names which will be resolved
	const arcSchema = z.discriminatedUnion("direction", [
		z.object({
			direction: z.literal("place_to_transition"),
			source_place: z.string().describe("Source place name"),
			target_transition: z.string().describe("Target transition name"),
			weight: z
				.number()
				.min(1)
				.optional()
				.describe("Arc weight (defaults to 1)"),
		}),
		z.object({
			direction: z.literal("transition_to_place"),
			source_transition: z.string().describe("Source transition name"),
			target_place: z.string().describe("Target place name"),
			weight: z
				.number()
				.min(1)
				.optional()
				.describe("Arc weight (defaults to 1)"),
		}),
	]);

	return z.object({
		places: z.array(placeSchema).optional().describe("Array of places to add"),
		transitions: z
			.array(transitionSchema)
			.optional()
			.describe("Array of transitions to add"),
		arcs: z.array(arcSchema).optional().describe("Array of arcs to add"),
	});
};

type AddNetElementsArgs = {
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

export async function addNetElements(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: AddNetElementsArgs,
) {
	// Map names to IDs for newly created elements
	const placeIdMap: Map<string, string> = new Map();
	const transitionIdMap: Map<string, string> = new Map();

	handle.change((doc) => {
		// Create places and build name-to-ID mapping
		if (args.places) {
			for (const placeArgs of args.places) {
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
				doc.petriNetDefinition.places.push(newPlace);
			}
		}

		// Create transitions and build name-to-ID mapping
		if (args.transitions) {
			for (const transitionArgs of args.transitions) {
				const newTransition: Transition = {
					id: generateUuid(),
					name: transitionArgs.name,
					inputArcs: [],
					outputArcs: [],
					lambdaType: transitionArgs.lambdaType ?? "predicate",
					lambdaCode: transitionArgs.lambdaCode ?? "",
					transitionKernelCode: transitionArgs.transitionKernelCode ?? "",
					x: transitionArgs.x ?? 100,
					y: transitionArgs.y ?? 100,
				};

				transitionIdMap.set(transitionArgs.name, newTransition.id);
				doc.petriNetDefinition.transitions.push(newTransition);
			}
		}

		// Add arcs to the appropriate transitions
		if (args.arcs) {
			for (const arcArgs of args.arcs) {
				if (arcArgs.direction === "place_to_transition") {
					// Find or resolve the place ID
					let placeId = placeIdMap.get(arcArgs.source_place);
					if (!placeId) {
						// Try to find existing place by name
						const existingPlace = doc.petriNetDefinition.places.find(
							(p) =>
								p.name === arcArgs.source_place ||
								p.id === arcArgs.source_place,
						);
						if (!existingPlace) {
							throw new Error(`Place "${arcArgs.source_place}" not found`);
						}
						placeId = existingPlace.id;
					}

					// Find or resolve the transition
					let transitionId = transitionIdMap.get(arcArgs.target_transition);
					if (!transitionId) {
						// Try to find existing transition by name
						const existingTransition = doc.petriNetDefinition.transitions.find(
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

					// Find the transition and add the input arc
					const transition = doc.petriNetDefinition.transitions.find(
						(t) => t.id === transitionId,
					);
					if (transition) {
						transition.inputArcs.push({
							placeId,
							weight: arcArgs.weight ?? 1,
						});
					}
				} else {
					// transition_to_place
					// Find or resolve the transition ID
					let transitionId = transitionIdMap.get(arcArgs.source_transition);
					if (!transitionId) {
						// Try to find existing transition by name
						const existingTransition = doc.petriNetDefinition.transitions.find(
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

					// Find or resolve the place
					let placeId = placeIdMap.get(arcArgs.target_place);
					if (!placeId) {
						// Try to find existing place by name
						const existingPlace = doc.petriNetDefinition.places.find(
							(p) =>
								p.name === arcArgs.target_place ||
								p.id === arcArgs.target_place,
						);
						if (!existingPlace) {
							throw new Error(`Place "${arcArgs.target_place}" not found`);
						}
						placeId = existingPlace.id;
					}

					// Find the transition and add the output arc
					const transition = doc.petriNetDefinition.transitions.find(
						(t) => t.id === transitionId,
					);
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

export default addNetElements;
