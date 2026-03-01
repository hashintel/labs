import { FC, useEffect } from "react";
import { navigate } from "../../../util/navigation";
import orderBy from "lodash-es/orderBy";

import type { LinkableProject } from "../../../features/project/types";
import { urlFromProject } from "../../../routes";
import { useUser } from "../../../features/user/UserContext";
import { useExamples } from "../../../features/examples/ExamplesContext";

/** Fallback when no projects exist (e.g. bootstrap failed or localStorage empty) */
const FALLBACK_PROJECT: LinkableProject = {
  pathWithNamespace: "@hash/wildfires-regrowth",
  ref: "main",
};

export const HashRouterEffectDefaultProject: FC = () => {
  const { bootstrapped, userProjects } = useUser();
  const { examples } = useExamples();

  useEffect(() => {
    if (bootstrapped) {
      const listToUse = userProjects.length ? userProjects : examples;
      const project = orderBy(listToUse, "updatedAt", "desc")[0];

      const defaultProject: LinkableProject = project
        ? {
            pathWithNamespace: project.pathWithNamespace,
            ref: userProjects.length ? "main" : project.ref ?? "main",
          }
        : FALLBACK_PROJECT;

      navigate(urlFromProject(defaultProject));
    }
  }, [bootstrapped, userProjects, examples]);

  return null;
};
