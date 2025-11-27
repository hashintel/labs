import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { z } from "zod";
import type { Doc } from "./datatype";

// ============================================================================
// Helper functions to query document state
// ============================================================================

const getPlaces = (doc: Doc): PlaceNodeType[] => {
	return doc.petriNetDefinition.nodes.filter(
		(node): node is PlaceNodeType => node.type === "place",
	);
};

const getTransitions = (doc: Doc): TransitionNodeType[] => {
	return doc.petriNetDefinition.nodes.filter(
		(node): node is TransitionNodeType => node.type === "transition",
	);
};

const getTokenTypes = (doc: Doc): TokenType[] => {
	return doc.petriNetDefinition.tokenTypes || [];
};

const findNodeById = (doc: Doc, nodeId: string) => {
	return doc.petriNetDefinition.nodes.find((node) => node.id === nodeId);
};

// ============================================================================
// Action: Add Place
// ============================================================================

// Base schema for place arguments (without id field)
export const getPlaceBaseSchema = (doc: Doc) => {
	const tokenTypes = getTokenTypes(doc);

	const baseSchema: Record<string, z.ZodTypeAny> = {
		label: z.string().describe("Label for the place"),
		x: z.number().optional().describe("X position (defaults to 100)"),
		y: z.number().optional().describe("Y position (defaults to 100)"),
	};

	// Add optional initial token count fields for each token type
	if (tokenTypes.length > 0) {
		for (const tokenType of tokenTypes) {
			baseSchema[`tokens_${tokenType.id}`] = z
				.number()
				.min(0)
				.optional()
				.describe(`Initial ${tokenType.name} tokens`);
		}
	}

	return baseSchema;
};

export const addPlaceArgsSchema = (doc: Doc) => {
	return z.object(getPlaceBaseSchema(doc));
};

export async function addPlace(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: { label: string; x?: number; y?: number; [key: string]: any },
) {
	handle.change((doc) => {
		const tokenTypes = getTokenTypes(doc);

		// Build initial token counts from args
		const initialTokenCounts: Record<string, number> = {};
		for (const tokenType of tokenTypes) {
			const key = `tokens_${tokenType.id}`;
			initialTokenCounts[tokenType.id] = args[key] ?? 0;
		}

		const data: PlaceNodeData = {
			type: "place",
			label: args.label,
		};

		// Only add initialTokenCounts if there are token types defined
		if (Object.keys(initialTokenCounts).length > 0) {
			data.initialTokenCounts = initialTokenCounts;
		}

		const newPlace: PlaceNodeType = {
			id: generateUuid(),
			type: "place",
			position: { x: args.x ?? 100, y: args.y ?? 100 },
			...nodeDimensions.place,
			data,
		};

		doc.petriNetDefinition.nodes.push(newPlace as any);
	});
}

// ============================================================================
// Action: Add Transition
// ============================================================================

// Base schema for transition arguments (without id field)
const getTransitionBaseSchema = (_doc: Doc) => {
	return {
		label: z.string().describe("Label for the transition"),
		x: z.number().optional().describe("X position (defaults to 100)"),
		y: z.number().optional().describe("Y position (defaults to 100)"),
		delay: z
			.number()
			.min(0)
			.optional()
			.describe("Transition delay in time units"),
		description: z
			.string()
			.optional()
			.describe("Description of what this transition does"),
	};
};

export const addTransitionArgsSchema = (_doc: Doc) => {
	return z.object(getTransitionBaseSchema(_doc));
};

export async function addTransition(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: {
		label: string;
		x?: number;
		y?: number;
		delay?: number;
		description?: string;
	},
) {
	handle.change((doc) => {
		const data: TransitionNodeData = {
			type: "transition",
			label: args.label,
		};

		// Only add optional fields if they are provided
		if (args.delay !== undefined) {
			data.delay = args.delay;
		}
		if (args.description !== undefined && args.description !== "") {
			data.description = args.description;
		}

		const newTransition: TransitionNodeType = {
			id: generateUuid(),
			type: "transition",
			position: { x: args.x ?? 100, y: args.y ?? 100 },
			...nodeDimensions.transition,
			data,
		};

		doc.petriNetDefinition.nodes.push(newTransition as any);
	});
}

// ============================================================================
// Action: Add Arc
// ============================================================================

export const addArcArgsSchema = (doc: Doc) => {
	const places = getPlaces(doc);
	const transitions = getTransitions(doc);
	const tokenTypes = getTokenTypes(doc);

	// Create labels for places and transitions
	const placeLabels = places.map((p) => p.data.label || p.id);
	const transitionLabels = transitions.map((t) => t.data.label || t.id);

	// Build token weight schema
	const tokenWeightSchema: Record<string, z.ZodTypeAny> = {};
	for (const tokenType of tokenTypes) {
		tokenWeightSchema[`weight_${tokenType.id}`] = z
			.number()
			.min(0)
			.optional()
			.describe(`Weight for ${tokenType.name} tokens (defaults to 0)`);
	}

	// Schema for place -> transition arcs
	const placeToTransitionSchema = z.object({
		direction: z.literal("place_to_transition"),
		source_place:
			placeLabels.length > 0
				? z.enum(placeLabels as [string, ...string[]]).describe("Source place")
				: z.string().describe("Source place (no places available yet)"),
		target_transition:
			transitionLabels.length > 0
				? z
						.enum(transitionLabels as [string, ...string[]])
						.describe("Target transition")
				: z
						.string()
						.describe("Target transition (no transitions available yet)"),
		...tokenWeightSchema,
	});

	// Schema for transition -> place arcs
	const transitionToPlaceSchema = z.object({
		direction: z.literal("transition_to_place"),
		source_transition:
			transitionLabels.length > 0
				? z
						.enum(transitionLabels as [string, ...string[]])
						.describe("Source transition")
				: z
						.string()
						.describe("Source transition (no transitions available yet)"),
		target_place:
			placeLabels.length > 0
				? z.enum(placeLabels as [string, ...string[]]).describe("Target place")
				: z.string().describe("Target place (no places available yet)"),
		...tokenWeightSchema,
	});

	// Return discriminated union based on direction
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
			[key: string]: any;
	  }
	| {
			direction: "transition_to_place";
			source_transition: string;
			target_place: string;
			[key: string]: any;
	  };

export async function addArc(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: AddArcArgs,
) {
	handle.change((doc) => {
		const places = getPlaces(doc);
		const transitions = getTransitions(doc);
		const tokenTypes = getTokenTypes(doc);

		// Find source and target based on direction
		let sourceId: string;
		let targetId: string;

		if (args.direction === "place_to_transition") {
			// Source is a place, target is a transition
			const sourcePlace = places.find(
				(p) => p.data.label === args.source_place || p.id === args.source_place,
			);
			const targetTransition = transitions.find(
				(t) =>
					t.data.label === args.target_transition ||
					t.id === args.target_transition,
			);

			if (!sourcePlace) {
				throw new Error(`Place "${args.source_place}" not found`);
			}
			if (!targetTransition) {
				throw new Error(`Transition "${args.target_transition}" not found`);
			}

			sourceId = sourcePlace.id;
			targetId = targetTransition.id;
		} else {
			// Source is a transition, target is a place
			const sourceTransition = transitions.find(
				(t) =>
					t.data.label === args.source_transition ||
					t.id === args.source_transition,
			);
			const targetPlace = places.find(
				(p) => p.data.label === args.target_place || p.id === args.target_place,
			);

			if (!sourceTransition) {
				throw new Error(`Transition "${args.source_transition}" not found`);
			}
			if (!targetPlace) {
				throw new Error(`Place "${args.target_place}" not found`);
			}

			sourceId = sourceTransition.id;
			targetId = targetPlace.id;
		}

		// Build token weights from args
		const tokenWeights: Record<string, number> = {};
		for (const tokenType of tokenTypes) {
			const key = `weight_${tokenType.id}`;
			tokenWeights[tokenType.id] = args[key] ?? 0;
		}

		const newArc = {
			id: `${sourceId}-${targetId}`,
			source: sourceId,
			target: targetId,
			type: "default" as const,
			interactionWidth: 8,
			data: {
				tokenWeights,
			},
		};

		doc.petriNetDefinition.arcs.push(newArc as any);
	});
}

// ============================================================================
// Action: Add Token Type
// ============================================================================

export const addTokenTypeArgsSchema = (_doc: Doc) => {
	return z.object({
		name: z.string().describe("Name of the token type"),
		color: z
			.string()
			.regex(/^#[0-9A-Fa-f]{6}$/)
			.describe("Color as hex code (e.g., #3498db)"),
	});
};

export async function addTokenType(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: { name: string; color: string },
) {
	handle.change((doc) => {
		const newTokenType: TokenType = {
			id: generateUuid(),
			name: args.name,
			color: args.color,
		};

		doc.petriNetDefinition.tokenTypes.push(newTokenType as any);

		// Initialize this token type in all existing places' initialTokenCounts
		const places = getPlaces(doc);
		for (const place of places) {
			if (!place.data.initialTokenCounts) {
				place.data.initialTokenCounts = {};
			}
			place.data.initialTokenCounts[newTokenType.id] = 0;
		}

		// Initialize this token type in all existing arcs' tokenWeights
		for (const arc of doc.petriNetDefinition.arcs) {
			if (!arc.data) {
				arc.data = { tokenWeights: {} };
			}
			if (!arc.data.tokenWeights) {
				arc.data.tokenWeights = {};
			}
			arc.data.tokenWeights[newTokenType.id] = 0;
		}
	});
}

// ============================================================================
// Action: Add Net
// ============================================================================

export const addNetElementsArgsSchema = (doc: Doc) => {
	const placeBaseSchema = getPlaceBaseSchema(doc);
	const placeSchema = z.object(placeBaseSchema);

	const transitionBaseSchema = getTransitionBaseSchema(doc);
	const transitionSchema = z.object(transitionBaseSchema);

	const arcSchema = addArcArgsSchema(doc);

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
		label: string;
		x?: number;
		y?: number;
		[key: string]: any;
	}>;
	transitions?: Array<{
		label: string;
		x?: number;
		y?: number;
		delay?: number;
		description?: string;
	}>;
	arcs?: Array<
		| {
				direction: "place_to_transition";
				source_place: string;
				target_transition: string;
				[key: string]: any;
		  }
		| {
				direction: "transition_to_place";
				source_transition: string;
				target_place: string;
				[key: string]: any;
		  }
	>;
};

export async function addNetElements(
	handle: DocHandle<Doc>,
	_repo: Repo,
	args: AddNetElementsArgs,
) {
	// Map labels to real IDs
	const placeIdMap: Map<string, string> = new Map();
	const transitionIdMap: Map<string, string> = new Map();

	handle.change((doc) => {
		// Create places and build label-to-ID mapping
		if (args.places) {
			for (const placeArgs of args.places) {
				const tokenTypes = getTokenTypes(doc);

				// Build initial token counts from args
				const initialTokenCounts: Record<string, number> = {};
				for (const tokenType of tokenTypes) {
					const key = `tokens_${tokenType.id}`;
					initialTokenCounts[tokenType.id] = placeArgs[key] ?? 0;
				}

				const data: PlaceNodeData = {
					type: "place",
					label: placeArgs.label,
				};

				// Only add initialTokenCounts if there are token types defined
				if (Object.keys(initialTokenCounts).length > 0) {
					data.initialTokenCounts = initialTokenCounts;
				}

				const newPlace: PlaceNodeType = {
					id: generateUuid(),
					type: "place",
					position: { x: placeArgs.x ?? 100, y: placeArgs.y ?? 100 },
					...nodeDimensions.place,
					data,
				};

				placeIdMap.set(placeArgs.label, newPlace.id);
				doc.petriNetDefinition.nodes.push(newPlace as any);
			}
		}

		// Create transitions and build label-to-ID mapping
		if (args.transitions) {
			for (const transitionArgs of args.transitions) {
				const data: TransitionNodeData = {
					type: "transition",
					label: transitionArgs.label,
				};

				// Only add optional fields if they are provided
				if (transitionArgs.delay !== undefined) {
					data.delay = transitionArgs.delay;
				}
				if (
					transitionArgs.description !== undefined &&
					transitionArgs.description !== ""
				) {
					data.description = transitionArgs.description;
				}

				const newTransition: TransitionNodeType = {
					id: generateUuid(),
					type: "transition",
					position: {
						x: transitionArgs.x ?? 100,
						y: transitionArgs.y ?? 100,
					},
					...nodeDimensions.transition,
					data,
				};

				transitionIdMap.set(transitionArgs.label, newTransition.id);
				doc.petriNetDefinition.nodes.push(newTransition as any);
			}
		}
	});

	// Create arcs with real IDs resolved from labels
	if (args.arcs) {
		for (const arcArgs of args.arcs) {
			if (arcArgs.direction === "place_to_transition") {
				// Resolve labels to real IDs
				const sourceId = placeIdMap.get(arcArgs.source_place);
				const targetId = transitionIdMap.get(arcArgs.target_transition);

				if (!sourceId) {
					throw new Error(
						`Place with label "${arcArgs.source_place}" not found`,
					);
				}
				if (!targetId) {
					throw new Error(
						`Transition with label "${arcArgs.target_transition}" not found`,
					);
				}

				await addArc(handle, _repo, {
					...arcArgs,
					source_place: sourceId,
					target_transition: targetId,
				});
			} else {
				// Resolve labels to real IDs
				const sourceId = transitionIdMap.get(arcArgs.source_transition);
				const targetId = placeIdMap.get(arcArgs.target_place);

				if (!sourceId) {
					throw new Error(
						`Transition with label "${arcArgs.source_transition}" not found`,
					);
				}
				if (!targetId) {
					throw new Error(
						`Place with label "${arcArgs.target_place}" not found`,
					);
				}

				await addArc(handle, _repo, {
					...arcArgs,
					source_transition: sourceId,
					target_place: targetId,
				});
			}
		}
	}
}

// ============================================================================
// Default export - you can choose which action to expose as default
// ============================================================================

export default addNetElements;
