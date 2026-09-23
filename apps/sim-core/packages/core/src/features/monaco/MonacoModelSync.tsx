import { FC, useRef } from "react";
import { useFiles } from "../files/FilesContext";
import { useProject } from "../project/ProjectContext";
import { syncModels } from "./monaco";
import type { HcFile } from "../files/types";

/**
 * Bridges React context state to the Monaco text model system.
 *
 * The Monaco subscriber creates/updates/disposes editor.ITextModel instances
 * based on the current project files. Previously this was wired to the Redux
 * app store via store.subscribe(), which ran synchronously during dispatch —
 * ensuring models existed before React rendered.
 *
 * To preserve that timing guarantee, syncModels is called synchronously
 * during render (guarded by a ref to skip redundant calls). This component
 * renders before the editor tree in the component hierarchy, so models are
 * available when HashCoreEditorFile calls getTextModel().
 *
 * Place this component inside both FilesProvider and ProjectProvider,
 * before any children that read Monaco models.
 */
export const MonacoModelSync: FC = () => {
  const { allFiles, filesDispatch } = useFiles();
  const { currentProjectUrl } = useProject();

  const syncedRef = useRef<{ files: HcFile[]; url: string | null } | null>(
    null,
  );

  if (
    !syncedRef.current ||
    syncedRef.current.files !== allFiles ||
    syncedRef.current.url !== currentProjectUrl
  ) {
    syncModels(allFiles, currentProjectUrl, filesDispatch);
    syncedRef.current = { files: allFiles, url: currentProjectUrl };
  }

  return null;
};
