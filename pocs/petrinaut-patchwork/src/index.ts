import { type Plugin } from "@patchwork/sdk";

export const plugins: Plugin<any>[] = [
	{
		type: "patchwork:dataType",
		id: "petrinaut",
		name: "Petrinaut",
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
		supportedDataTypes: ["petrinaut"],
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
		supportedDataTypes: ["petrinaut"],
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
		supportedDataTypes: ["petrinaut"],
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
		supportedDataTypes: ["petrinaut"],
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
		supportedDataTypes: ["petrinaut"],
		async load() {
			const { addArc, addArcArgsSchema } = await import("./actions");
			return { default: addArc, argsSchema: addArcArgsSchema };
		},
	},
	{
		type: "patchwork:action",
		id: "petrinaut-add-token-type",
		name: "Add Token Type",
		icon: "Palette",
		supportedDataTypes: ["petrinaut"],
		async load() {
			const { addTokenType, addTokenTypeArgsSchema } = await import(
				"./actions"
			);
			return { default: addTokenType, argsSchema: addTokenTypeArgsSchema };
		},
	},
];
