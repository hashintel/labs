import { LinkableProject } from "../../../features/project/types";
import { ProjectAccessCodeAccessType } from "../../../shared/scopes";
import { query } from "../query";

export const requestPrivateProjectAccessCode = async (
  project: LinkableProject,
  level: ProjectAccessCodeAccessType
) =>
  (
    await query<{
      requestPrivateProjectAccessCode: { code: { code: string } };
    }>(
      `
      mutation requestAccessCode($project: String!, $level: ProjectAccessCodeAccessType!) {
        requestPrivateProjectAccessCode(projectPath: $project, accessLevel: $level) {
           code { code }
        }
      }
    `,
      { project: project.pathWithNamespace, level }
    )
  ).requestPrivateProjectAccessCode.code.code;
