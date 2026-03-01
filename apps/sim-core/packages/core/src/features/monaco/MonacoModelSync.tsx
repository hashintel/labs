import { FC, useEffect } from "react";
import { useFiles } from "../files/FilesContext";
import { useProject } from "../project/ProjectContext";
import { syncModels } from "./monaco";

/**
 * Bridges React context state to the Monaco text model system.
 *
 * The Monaco subscriber creates/updates/disposes editor.ITextModel instances
 * based on the current project files. Previously this was wired to the Redux
 * app store; now it syncs from FilesContext and ProjectContext.
 *
 * Place this component inside both FilesProvider and ProjectProvider.
 */
export const MonacoModelSync: FC = () => {
  const { allFiles, filesDispatch } = useFiles();
  const { currentProjectUrl } = useProject();

  useEffect(() => {
    syncModels(allFiles, currentProjectUrl, filesDispatch);
  }, [allFiles, currentProjectUrl, filesDispatch]);

  return null;
};
