import completions from "./completions.d.ts?raw";
import completionsHStd from "./completions-hstd.d.ts?raw";
import { languages } from "monaco-editor";

export function configureJsCompletions() {
  languages.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    target: languages.typescript.ScriptTarget.ES2020,
    moduleResolution: languages.typescript.ModuleResolutionKind.NodeJs,
    lib: ["!DOM"],
  });

  languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  languages.typescript.javascriptDefaults.setInlayHintsOptions({
    includeInlayParameterNameHints: "literals",
    includeInlayFunctionLikeReturnTypeHints: true,
  });

  languages.typescript.javascriptDefaults.addExtraLib(completions);
  languages.typescript.javascriptDefaults.addExtraLib(completionsHStd);
  languages.typescript.javascriptDefaults.addExtraLib(
    completionsHStd?.replace(/hstd/g, "hash_stdlib"),
  );
}
