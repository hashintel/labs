import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { Workspace } from "@patchwork/llm";
import type {
	Color,
	DifferentialEquation,
	Parameter,
	Place,
	SDCPN,
	Transition,
} from "@hashintel/petrinaut";

/** "standard" or "inhibitor" — an inhibitor arc blocks its transition while the place holds tokens. */
type ArcType = Transition["inputArcs"][number]["type"];

type PetriNetDoc = {
	"@patchwork": { type: "petrinaut-petrinet" };
	title: string;
	petriNetDefinition: SDCPN;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ARC_ID_PREFIX = "$A_";
const ARC_ID_SEPARATOR = "___";

function generateArcId(inputId: string, outputId: string) {
	return `${ARC_ID_PREFIX}${inputId}${ARC_ID_SEPARATOR}${outputId}`;
}

function findPlace(def: SDCPN, nameOrId: string) {
	return def.places.find((p) => p.name === nameOrId || p.id === nameOrId);
}

function findTransition(def: SDCPN, nameOrId: string) {
	return def.transitions.find(
		(t) => t.name === nameOrId || t.id === nameOrId,
	);
}

type RemoveItem =
	| { type: "place"; id: string }
	| { type: "transition"; id: string }
	| { type: "arc"; id: string }
	| { type: "type"; id: string }
	| { type: "differentialEquation"; id: string }
	| { type: "parameter"; id: string };

function deleteItemsFromSdcpn(sdcpn: SDCPN, items: RemoveItem[]) {
	if (items.length === 0) return;

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

	if (placeIds.size > 0 || transitionIds.size > 0 || arcIds.size > 0) {
		for (let i = sdcpn.transitions.length - 1; i >= 0; i--) {
			const transition = sdcpn.transitions[i];
			if (!transition) continue;
			if (transitionIds.has(transition.id)) {
				sdcpn.transitions.splice(i, 1);
				continue;
			}

			for (let j = transition.inputArcs.length - 1; j >= 0; j--) {
				const arc = transition.inputArcs[j];
				if (!arc) continue;
				const arcId = generateArcId(arc.placeId, transition.id);
				if (arcIds.has(arcId) || placeIds.has(arc.placeId)) {
					transition.inputArcs.splice(j, 1);
				}
			}

			for (let j = transition.outputArcs.length - 1; j >= 0; j--) {
				const arc = transition.outputArcs[j];
				if (!arc) continue;
				const arcId = generateArcId(transition.id, arc.placeId);
				if (arcIds.has(arcId) || placeIds.has(arc.placeId)) {
					transition.outputArcs.splice(j, 1);
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
		for (const eq of sdcpn.differentialEquations) {
			if (eq.colorId && typeIds.has(eq.colorId)) {
				eq.colorId = null;
			}
		}
	}

	if (equationIds.size > 0) {
		for (let i = sdcpn.differentialEquations.length - 1; i >= 0; i--) {
			const eq = sdcpn.differentialEquations[i];
			if (eq && equationIds.has(eq.id)) {
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
			const param = sdcpn.parameters[i];
			if (param && parameterIds.has(param.id)) {
				sdcpn.parameters.splice(i, 1);
			}
		}
	}
}

// ─── Arc direction types ──────────────────────────────────────────────────────

type PlaceToTransitionArc = {
	direction: "place_to_transition";
	source_place: string;
	target_transition: string;
	weight?: number;
	type?: ArcType;
};

type TransitionToPlaceArc = {
	direction: "transition_to_place";
	source_transition: string;
	target_place: string;
	weight?: number;
};

type ArcArgs = PlaceToTransitionArc | TransitionToPlaceArc;

type BatchAdd = {
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
		inputArcs: Transition["inputArcs"];
		outputArcs: Transition["outputArcs"];
	}>;
	arcs?: ArcArgs[];
};

// ─── Default export: constructor function ─────────────────────────────────────

export default function (workspace: Workspace) {
	return {
		async createPetriNet(title?: string) {
			const handle: DocHandle<PetriNetDoc> = await workspace.create<PetriNetDoc>({
				name: title ?? "Untitled Petri Net",
				type: "petrinaut-petrinet",
			});
			handle.change((doc) => {
				doc["@patchwork"] = { type: "petrinaut-petrinet" };
				doc.title = title ?? "Untitled Petri Net";
				doc.petriNetDefinition = {
					places: [],
					transitions: [],
					types: [],
					parameters: [],
					differentialEquations: [],
				};
			});
			return { handle, url: handle.url };
		},

		async getPetriNet(url: AutomergeUrl) {
			const handle: DocHandle<PetriNetDoc> = await workspace.find<PetriNetDoc>(url);

			return {
				get url() {
					return handle.url;
				},

				// ── Read methods ────────────────────────────────────────────

				getPlaces(): Place[] {
					return handle.doc()?.petriNetDefinition.places ?? [];
				},

				getTransitions(): Transition[] {
					return handle.doc()?.petriNetDefinition.transitions ?? [];
				},

				getArcs() {
					const def = handle.doc()?.petriNetDefinition;
					if (!def) return [];
					const arcs: Array<{
						id: string;
						direction: "place_to_transition" | "transition_to_place";
						placeId: string;
						transitionId: string;
						weight: number;
						type?: ArcType;
					}> = [];
					for (const t of def.transitions) {
						for (const ia of t.inputArcs) {
							arcs.push({
								id: generateArcId(ia.placeId, t.id),
								direction: "place_to_transition",
								placeId: ia.placeId,
								transitionId: t.id,
								weight: ia.weight,
								type: ia.type,
							});
						}
						for (const oa of t.outputArcs) {
							arcs.push({
								id: generateArcId(t.id, oa.placeId),
								direction: "transition_to_place",
								placeId: oa.placeId,
								transitionId: t.id,
								weight: oa.weight,
							});
						}
					}
					return arcs;
				},

				getColors(): Color[] {
					return handle.doc()?.petriNetDefinition.types ?? [];
				},

				getDifferentialEquations(): DifferentialEquation[] {
					return (
						handle.doc()?.petriNetDefinition.differentialEquations ?? []
					);
				},

				getParameters(): Parameter[] {
					return handle.doc()?.petriNetDefinition.parameters ?? [];
				},

				getTitle(): string {
					return handle.doc()?.title ?? "";
				},

				// ── Write methods ───────────────────────────────────────────

				addPlace(args: {
					name: string;
					colorId?: string;
					x?: number;
					y?: number;
					dynamicsEnabled?: boolean;
					differentialEquationId?: string;
					visualizerCode?: string;
				}) {
					const newPlace: Place = {
						id: crypto.randomUUID(),
						name: args.name,
						colorId: args.colorId ?? null,
						dynamicsEnabled: args.dynamicsEnabled ?? false,
						differentialEquationId: args.differentialEquationId ?? null,
						x: args.x ?? 100,
						y: args.y ?? 100,
						visualizerCode: args.visualizerCode,
					};
					handle.change((doc) => {
						doc.petriNetDefinition.places.push(newPlace);
					});
					return newPlace;
				},

				addTransition(args: {
					name: string;
					x?: number;
					y?: number;
					lambdaType?: "predicate" | "stochastic";
					lambdaCode?: string;
					transitionKernelCode?: string;
					inputArcs: Transition["inputArcs"];
					outputArcs: Transition["outputArcs"];
				}) {
					const newTransition: Transition = {
						id: crypto.randomUUID(),
						name: args.name,
						inputArcs: args.inputArcs,
						outputArcs: args.outputArcs,
						lambdaType: args.lambdaType ?? "predicate",
						lambdaCode: args.lambdaCode ?? "",
						transitionKernelCode: args.transitionKernelCode ?? "",
						x: args.x ?? 100,
						y: args.y ?? 100,
					};
					handle.change((doc) => {
						doc.petriNetDefinition.transitions.push(newTransition);
					});
					return newTransition;
				},

				addArc(args: ArcArgs) {
					handle.change((doc) => {
						const def = doc.petriNetDefinition;
						if (args.direction === "place_to_transition") {
							const place = findPlace(def, args.source_place);
							if (!place)
								throw new Error(
									`Place "${args.source_place}" not found`,
								);
							const transition = findTransition(
								def,
								args.target_transition,
							);
							if (!transition)
								throw new Error(
									`Transition "${args.target_transition}" not found`,
								);
							transition.inputArcs.push({
								placeId: place.id,
								weight: args.weight ?? 1,
								type: args.type ?? "standard",
							});
						} else {
							const transition = findTransition(
								def,
								args.source_transition,
							);
							if (!transition)
								throw new Error(
									`Transition "${args.source_transition}" not found`,
								);
							const place = findPlace(def, args.target_place);
							if (!place)
								throw new Error(
									`Place "${args.target_place}" not found`,
								);
							transition.outputArcs.push({
								placeId: place.id,
								weight: args.weight ?? 1,
							});
						}
					});
				},

				addColor(args: {
					name: string;
					iconSlug?: string;
					displayColor: string;
					elements?: Array<{
						name: string;
						type: "real" | "integer" | "boolean";
					}>;
				}) {
					const newColor: Color = {
						id: crypto.randomUUID(),
						name: args.name,
						iconSlug: args.iconSlug ?? "circle",
						displayColor: args.displayColor,
						elements: (args.elements ?? []).map((el) => ({
							elementId: crypto.randomUUID(),
							name: el.name,
							type: el.type,
						})),
					};
					handle.change((doc) => {
						doc.petriNetDefinition.types.push(newColor);
					});
					return newColor;
				},

				addDifferentialEquation(args: {
					name: string;
					colorId: string;
					code: string;
				}) {
					const newEq: DifferentialEquation = {
						id: crypto.randomUUID(),
						name: args.name,
						colorId: args.colorId,
						code: args.code,
					};
					handle.change((doc) => {
						doc.petriNetDefinition.differentialEquations.push(newEq);
					});
					return newEq;
				},

				addParameter(args: {
					name: string;
					variableName: string;
					type: "real" | "integer" | "boolean";
					defaultValue: string;
				}) {
					const newParam: Parameter = {
						id: crypto.randomUUID(),
						name: args.name,
						variableName: args.variableName,
						type: args.type,
						defaultValue: args.defaultValue,
					};
					handle.change((doc) => {
						doc.petriNetDefinition.parameters.push(newParam);
					});
					return newParam;
				},

				setTitle(title: string) {
					handle.change((doc) => {
						doc.title = title;
					});
				},

				// ── Delete ──────────────────────────────────────────────────

				removeItems(items: RemoveItem[]) {
					if (!items || items.length === 0) return;
					handle.change((doc) => {
						deleteItemsFromSdcpn(doc.petriNetDefinition, items);
					});
				},

				// ── Batch modify ────────────────────────────────────────────

				modifyNetElements({
					add,
					remove,
				}: {
					add?: BatchAdd;
					remove?: RemoveItem[];
				}) {
					const placeIdMap = new Map<string, string>();
					const transitionIdMap = new Map<string, string>();

					handle.change((doc) => {
						const def: SDCPN = doc.petriNetDefinition;

						if (remove?.length) {
							deleteItemsFromSdcpn(def, remove);
						}

						if (!add) return;

						if (add.places) {
							for (const p of add.places) {
								const newPlace: Place = {
									id: crypto.randomUUID(),
									name: p.name,
									colorId: p.colorId ?? null,
									dynamicsEnabled: p.dynamicsEnabled ?? false,
									differentialEquationId:
										p.differentialEquationId ?? null,
									x: p.x ?? 100,
									y: p.y ?? 100,
									visualizerCode: p.visualizerCode,
								};
								placeIdMap.set(p.name, newPlace.id);
								def.places.push(newPlace);
							}
						}

						if (add.transitions) {
							for (const t of add.transitions) {
								const newTransition: Transition = {
									id: crypto.randomUUID(),
									name: t.name,
									inputArcs: t.inputArcs,
									outputArcs: t.outputArcs,
									lambdaType: t.lambdaType ?? "predicate",
									lambdaCode: t.lambdaCode ?? "",
									transitionKernelCode:
										t.transitionKernelCode ?? "",
									x: t.x ?? 100,
									y: t.y ?? 100,
								};
								transitionIdMap.set(t.name, newTransition.id);
								def.transitions.push(newTransition);
							}
						}

						if (add.arcs) {
							for (const arcArgs of add.arcs) {
								if (arcArgs.direction === "place_to_transition") {
									let placeId = placeIdMap.get(
										arcArgs.source_place,
									);
									if (!placeId) {
										const existing = findPlace(
											def,
											arcArgs.source_place,
										);
										if (!existing)
											throw new Error(
												`Place "${arcArgs.source_place}" not found`,
											);
										placeId = existing.id;
									}

									let transitionId = transitionIdMap.get(
										arcArgs.target_transition,
									);
									if (!transitionId) {
										const existing = findTransition(
											def,
											arcArgs.target_transition,
										);
										if (!existing)
											throw new Error(
												`Transition "${arcArgs.target_transition}" not found`,
											);
										transitionId = existing.id;
									}

									const transition = def.transitions.find(
										(t) => t.id === transitionId,
									);
									if (transition) {
										transition.inputArcs.push({
											placeId,
											weight: arcArgs.weight ?? 1,
											type: arcArgs.type ?? "standard",
										});
									}
								} else {
									let transitionId = transitionIdMap.get(
										arcArgs.source_transition,
									);
									if (!transitionId) {
										const existing = findTransition(
											def,
											arcArgs.source_transition,
										);
										if (!existing)
											throw new Error(
												`Transition "${arcArgs.source_transition}" not found`,
											);
										transitionId = existing.id;
									}

									let placeId = placeIdMap.get(
										arcArgs.target_place,
									);
									if (!placeId) {
										const existing = findPlace(
											def,
											arcArgs.target_place,
										);
										if (!existing)
											throw new Error(
												`Place "${arcArgs.target_place}" not found`,
											);
										placeId = existing.id;
									}

									const transition = def.transitions.find(
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
				},
			};
		},
	};
}
