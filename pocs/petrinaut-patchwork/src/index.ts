import type { Plugin } from "@patchwork/sdk";

export const plugins: Plugin<any>[] = [
	{
		type: "patchwork:dataType",
		id: "petrinaut-petrinet",
		name: "Petri net",
		icon: "Network",
		async load() {
			const { dataType } = await import("./datatype");
			return dataType;
		},
	},

	{
		type: "patchwork:tool",
		id: "petrinaut",
		name: "Petrinaut",
		icon: "Network",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { Tool } = await import("./tool");
			return { EditorComponent: Tool };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-net-elements",
		name: "Add Net Elements",
		icon: "Plus",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addNetElements, addNetElementsArgsSchema } = await import(
				"./actions"
			);
			return { default: addNetElements, argsSchema: addNetElementsArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-place",
		name: "Add Place",
		icon: "Circle",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addPlace, addPlaceArgsSchema } = await import("./actions");
			return { default: addPlace, argsSchema: addPlaceArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-transition",
		name: "Add Transition",
		icon: "Square",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addTransition, addTransitionArgsSchema } = await import(
				"./actions"
			);
			return { default: addTransition, argsSchema: addTransitionArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-arc",
		name: "Add Arc",
		icon: "ArrowRight",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addArc, addArcArgsSchema } = await import("./actions");
			return { default: addArc, argsSchema: addArcArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-color",
		name: "Add Color/Type",
		icon: "Palette",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addColor, addColorArgsSchema } = await import("./actions");
			return { default: addColor, argsSchema: addColorArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-differential-equation",
		name: "Add Differential Equation",
		icon: "Function",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addDifferentialEquation, addDifferentialEquationArgsSchema } =
				await import("./actions");
			return {
				default: addDifferentialEquation,
				argsSchema: addDifferentialEquationArgsSchema,
			};
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-parameter",
		name: "Add Parameter",
		icon: "Variable",
		supportedDataTypes: ["petrinaut-petrinet"],
		async load() {
			const { addParameter, addParameterArgsSchema } = await import(
				"./actions"
			);
			return { default: addParameter, argsSchema: addParameterArgsSchema };
		},
	},
];
