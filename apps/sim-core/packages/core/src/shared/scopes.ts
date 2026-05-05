/**
 * This file is shared with core, so do not import any API code in here that cannot be packaged with Core
 */
export const ProjectAccessCodeAccessTypes = [
  "Write",
  "Read",
  "ReadEmbed",
] as const;

export type ProjectAccessCodeAccessType =
  (typeof ProjectAccessCodeAccessTypes)[number];

export enum ProjectAccessScope {
  Read = "Read",
  Write = "Write",

  /**
   * Some APIs may be necessary for embedded core whilst others only for full core – use Read if you want to prevent
   * embedded accessing the API, and ReadEmbed if either can
   */
  ReadEmbed = "ReadEmbed",
}

export const projectAccessLevelScopes: Record<
  ProjectAccessCodeAccessType,
  ProjectAccessScope[]
> = {
  Read: [ProjectAccessScope.ReadEmbed, ProjectAccessScope.Read],
  ReadEmbed: [ProjectAccessScope.ReadEmbed],
  Write: [
    ProjectAccessScope.Write,
    ProjectAccessScope.Read,
    ProjectAccessScope.ReadEmbed,
  ],
};
