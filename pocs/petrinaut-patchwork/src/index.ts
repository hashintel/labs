import type { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
	{
		type: "patchwork:datatype",
		id: "petrinaut-petrinet",
		name: "Petrinaut Net",
		icon: "Network",
		async load() {
			const { PetrinautDataType } = await import("./datatype");
			return PetrinautDataType;
		},
	},

	{
		type: "patchwork:tool",
		id: "petrinaut",
		name: "Petrinaut",
		icon: "Network",
		supportedDatatypes: ["petrinaut-petrinet"],
		async load() {
			const { renderPetrinautEditor } = await import("./tool");
			return renderPetrinautEditor;
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-modify-net-elements",
		name: "Modify Net Elements",
		icon: "Plus",
		supportedDatatypes: ["petrinaut-petrinet"],
		async load() {
			const { modifyNetElements, modifyNetElementsArgsSchema } = await import(
				"./actions"
			);
			return {
				default: modifyNetElements,
				argsSchema: modifyNetElementsArgsSchema,
			};
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-place",
		name: "Add Place",
		icon: "Circle",
		supportedDatatypes: ["petrinaut-petrinet"],
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
		supportedDatatypes: ["petrinaut-petrinet"],
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
		supportedDatatypes: ["petrinaut-petrinet"],
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
		supportedDatatypes: ["petrinaut-petrinet"],
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
		supportedDatatypes: ["petrinaut-petrinet"],
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
		supportedDatatypes: ["petrinaut-petrinet"],
		async load() {
			const { addParameter, addParameterArgsSchema } = await import(
				"./actions"
			);
			return { default: addParameter, argsSchema: addParameterArgsSchema };
		},
	},
];
