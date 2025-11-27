import { useDocHandle } from "@automerge/automerge-repo-react-hooks";
import type { EditorProps } from "@patchwork/sdk";
import type React from "react";
import { Petrinaut } from "./main/vendor/petrinaut";
import type { Doc } from "./datatype";
import { CacheProvider } from "@emotion/react";
import { ScopedCssBaseline, ThemeProvider } from "@mui/material";
import { createEmotionCache, theme } from "@hashintel/design-system/theme";

const emotionCache = createEmotionCache();

export const Tool: React.FC<EditorProps<Doc, string>> = ({ docUrl }) => {
  const handle = useDocHandle<Doc>(docUrl, { suspense: true });

  const doc = handle.doc();
  if (!doc) return null;

  return (
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={theme}>
        <ScopedCssBaseline />
        <Petrinaut
          key={docUrl}
          hideNetManagementControls
          petriNetId={docUrl}
          petriNetDefinition={doc.petriNetDefinition}
          existingNets={[]}
          mutatePetriNetDefinition={(mutationFn) => {
            handle.change((d) => {
              mutationFn(d.petriNetDefinition);
            });
          }}
          parentNet={null}
          createNewNet={() => {
            throw new Error("Creation not supported via Patchwork wrapper");
          }}
          loadPetriNet={() => {
            throw new Error(
              "Loading other nets not supported via Patchwork wrapper"
            );
          }}
          setTitle={() => {
            throw new Error("setTitle handled by Patchwork data type");
          }}
          title={""}
        />
      </ThemeProvider>
    </CacheProvider>
  );
};
