import { FC, useEffect, useRef } from "react";
import { navigate } from "../../../util/navigation";
import orderBy from "lodash-es/orderBy";

import { urlFromProject } from "../../../routes";
import { useUser } from "../../../features/user/UserContext";
import { useExamples } from "../../../features/examples/ExamplesContext";
import { fetchAndParseProject } from "../../../features/files/hooks";
import { preparePartialSimulationProject } from "../../../features/project/utils";
import { useProject } from "../../../features/project/ProjectContext";
import {
  fetchExampleManifest,
  exampleZipUrl,
} from "../../../util/exampleProjects";

export const HashRouterEffectDefaultProject: FC = () => {
  const { bootstrapped, userProjects, addUserProject } = useUser();
  const { examples } = useExamples();
  const { setProjectWithMeta } = useProject();
  const importingRef = useRef(false);

  useEffect(() => {
    if (!bootstrapped) return;

    if (userProjects.length) {
      const project = orderBy(userProjects, "updatedAt", "desc")[0];
      navigate(
        urlFromProject({ pathWithNamespace: project.pathWithNamespace, ref: "main" }),
      );
      return;
    }

    if (importingRef.current) return;
    importingRef.current = true;

    (async () => {
      try {
        const manifest = await fetchExampleManifest();
        const defaultEntry =
          manifest.find((e) => e.default) ?? manifest[0];

        if (!defaultEntry) {
          console.warn("No example projects available");
          return;
        }

        const url = exampleZipUrl(defaultEntry);
        const project = await fetchAndParseProject(
          url,
          defaultEntry.name,
          "@example",
        );

        addUserProject(preparePartialSimulationProject(project));
        setProjectWithMeta(project);
        navigate(urlFromProject(project), false, {}, true);
      } catch (err) {
        console.error("Failed to load default example project:", err);
      }
    })();
  }, [bootstrapped, userProjects, examples, addUserProject, setProjectWithMeta]);

  return null;
};
