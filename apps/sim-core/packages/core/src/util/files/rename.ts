import type { HcFile } from "../../features/files/types";
import { HcFileKind } from "../../features/files/enums";
import type { ParsedPath } from "./types";

type RequiredFileKeys = Pick<HcFile, "id" | "kind" | "path">;

export const destinationPathInUse = (
  files: RequiredFileKeys[],
  sourceId: string | undefined | null,
  destination: ParsedPath,
) =>
  files.some((file) =>
    file.kind === HcFileKind.Behavior &&
    (sourceId ? sourceId !== file.id : true)
      ? file.path.formatted.toLowerCase() ===
        destination.formatted.toLowerCase()
      : false,
  );
