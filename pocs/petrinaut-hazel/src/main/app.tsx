import { useCallback, useState } from "react";
import {
	Petrinaut,
	defaultTokenTypes,
	type PetriNetDefinitionObject,
} from "@hashintel/petrinaut";
import {
	useHazelIntegration,
	type HazelSimulationState,
	type HazelValue,
} from "./app/use-hazel-integration";
import { produce } from "immer";
import type { MinimalNetMetadata, SimulationState } from "@hashintel/petrinaut";

const createDefaultNetDefinition = (): PetriNetDefinitionObject => {
	return {
		nodes: [],
		arcs: [],
		tokenTypes: structuredClone(defaultTokenTypes),
	};
};

const existingNets: MinimalNetMetadata[] = [];

/**
 * An incomplete type guard to check if a value is a valid Petri net definition.
 * Does not check the content of arrays.
 */
const isValidNetDefinition = (
	definition: unknown,
): definition is PetriNetDefinitionObject => {
	if (typeof definition !== "object" || definition === null) {
		return false;
	}

	if (!("nodes" in definition) || !Array.isArray(definition.nodes)) {
		return false;
	}

	if (!("arcs" in definition) || !Array.isArray(definition.arcs)) {
		return false;
	}

	if (!("tokenTypes" in definition) || !Array.isArray(definition.tokenTypes)) {
		return false;
	}

	return true;
};

/**
 * Converts SimulationState to a 2D array format.
 * Each step becomes an array of objects with placeId, marking, and placeLabel.
 *
 * Marking is also converted to a representation of an association list.
 */
const simulationStateToHazelFormat = (
	simulationState: SimulationState,
): HazelSimulationState => {
	return simulationState.map((step) => {
		return Object.entries(step).map(([placeId, { marking, placeLabel }]) => ({
			placeId,
			marking: Object.entries(marking).map(([tokenId, count]) => ({
				0: tokenId,
				1: count,
			})),
			placeLabel,
		}));
	});
};

const convertSimulationStateForHazel = (
	simulationState: SimulationState,
): HazelValue["simulationState"] => {
	if (
		simulationState.length === 0 ||
		Object.keys(simulationState[0]).length === 0
	) {
		/**
		 * Hazel errors if sent an empty array at the root of an object value returned, e.g. { simulationState: [] }.
		 */
		return undefined;
	}

	return simulationStateToHazelFormat(simulationState);
};

/**
 * Wraps Petrinaut with the event handlers necessary for a Hazel Livelit.
 */
export const App = () => {
	const urlParams = new URLSearchParams(window.location.search);
	const id = urlParams.get("id") || "local-demo";

	const [netDefinition, setNetDefinition] =
		useState<PetriNetDefinitionObject | null>(null);
	const [simulationState, setSimulationState] = useState<SimulationState>([]);

	const { setSyntax } = useHazelIntegration({
		id,
		codec: "json",
		onInit: (value) => {
			try {
				const parsedValue = JSON.parse(value);

				const { netDefinition, simulationState } = parsedValue;

				if (isValidNetDefinition(netDefinition)) {
					setNetDefinition(netDefinition);
					setSimulationState(simulationState ?? []);
				} else {
					console.error("Invalid net definition", netDefinition);
					const defaultNetDefinition = createDefaultNetDefinition();
					setNetDefinition(defaultNetDefinition);

					setSyntax({
						netDefinition: defaultNetDefinition,
						simulationState: convertSimulationStateForHazel(simulationState),
					});
				}
			} catch (error) {
				console.error("Error parsing net definition as JSON", error);
			}
		},
	});

	const reportSimulationState = useCallback(
		(simulationState: SimulationState) => {
			setSimulationState(simulationState);

			setSyntax({
				netDefinition: netDefinition as PetriNetDefinitionObject,
				simulationState: convertSimulationStateForHazel(simulationState),
			});
		},
		[netDefinition, setSyntax],
	);

	const mutatePetriNetDefinition = useCallback(
		(definitionMutationFn: (definition: PetriNetDefinitionObject) => void) => {
			setNetDefinition((existingDefinition) => {
				const newDefinition = produce(existingDefinition, definitionMutationFn);
				setSyntax({
					netDefinition: newDefinition as PetriNetDefinitionObject,
					simulationState: convertSimulationStateForHazel(simulationState),
				});
				return newDefinition;
			});
		},
		[setSyntax, simulationState],
	);

	if (!netDefinition) {
		if (typeof window !== "undefined" && window.self === window.top) {
			return (
				<p style={{ padding: 15 }}>
					This application is designed to be run in an iFrame.
				</p>
			);
		}
		return null;
	}

	return (
		<Petrinaut
			key={id}
			hideNetManagementControls="includeLoadExampleOnly"
			petriNetId={id}
			petriNetDefinition={netDefinition}
			existingNets={existingNets}
			mutatePetriNetDefinition={mutatePetriNetDefinition}
			parentNet={null}
			createNewNet={({ petriNetDefinition }) => {
				setNetDefinition(petriNetDefinition);
				setSimulationState([]);
				setSyntax({
					netDefinition: petriNetDefinition,
					simulationState: undefined,
				});
			}}
			loadPetriNet={() => {
				throw new Error(
					"Petrinaut should not be attemping to load other nets when used as a Hazel livelit",
				);
			}}
			reportSimulationState={reportSimulationState}
			setTitle={() => {
				throw new Error(
					"Petrinaut should not be attemping to set the net title when used as a Hazel livelit",
				);
			}}
			title={""}
		/>
	);
};
