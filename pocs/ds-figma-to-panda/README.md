# ds-figma-to-panda

This is a POC for a getting from a Figma variables export, to a Panda CSS theme configuration object, which can be directly used in the panda config of the design-system. 

## TODOs

- [ ] establish coordinatedthe variables nomenclature in Figma
- [ ] write a transformation script backed by Zod schema verification, that takes Figma variables output JSON and produces a well-formed PandaCSS theme token configuration object
- [ ] create various demo "stories" in Ladle to demonstrate visual matching of the token and variant structures, against the Figma originals (swatches, surfaces, spacings, button and input variants, etc.)
