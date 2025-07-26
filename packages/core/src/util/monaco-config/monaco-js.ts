import completions from "./completions.d.ts?raw";
import completionsHStd from "./completions-hstd.d.ts?raw";
import { languages } from "monaco-editor";

export function configureJsCompletions() {
  /**
   * We can omit the dom from showing up in autocompletions using ["!DOM"]
   * @see https://stackoverflow.com/questions/41581570/how-to-remove-autocompletions-for-monaco-editor-using-javascript
   * @see allowJS allows us to enable typings in Javscript
   * @see allowNonTsExtensions lets us add arbitrary typing files
   */
  languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    lib: ["!DOM"],
  });

  // We add in our completions from completions.d.ts
  languages.typescript.javascriptDefaults.addExtraLib(completions);
  languages.typescript.javascriptDefaults.addExtraLib(completionsHStd);
  languages.typescript.javascriptDefaults.addExtraLib(
    completionsHStd?.replace(/hstd/g, "hash_stdlib"),
  );
}
