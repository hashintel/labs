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
		type: "patchwork:skill",
		id: "petrinaut-petrinet",
		name: "Petrinaut Net",
		description:
			"Creates and manages Petrinaut Petri Net documents with places and transitions.",
		async load() {
			return {
				documentation: (await import("./SKILL.md?raw")).default,
				api: (await import("./skill-api")).default,
			};
		},
	},
];
