import {
  ProjectAccessCodeAccessType,
  ProjectAccessCodeAccessTypes,
  ProjectAccessScope,
  projectAccessLevelScopes,
} from "../shared/scopes";
import { ProjectAccessParsed } from "../features/project/types";

export interface AccessCodeParam {
  accessCode?: string | null;
}

export interface ParseAccessCodeParam {
  access?: ProjectAccessParsed;
}

const isValidAccessLevel = (
  level: string,
): level is ProjectAccessCodeAccessType =>
  ProjectAccessCodeAccessTypes.includes(level as any);

const parseAccessLevel = (level: string): ProjectAccessCodeAccessType => {
  if (!isValidAccessLevel(level)) {
    throw new Error(`Unrecognised access level ${level}`);
  }

  return level;
};

export const parseAccessCodeInParams = <
  T extends Record<Exclude<any, "accessCode">, any>,
>(
  { accessCode, ...params }: AccessCodeParam & T,
  requiredScope?: ProjectAccessScope,
): ParseAccessCodeParam & T => {
  const castParams = params as T;

  if (accessCode) {
    try {
      const json = atob(accessCode);
      const parsed = JSON.parse(json) as { accessLevel: string };
      const accessLevel = parseAccessLevel(parsed.accessLevel);

      if (
        accessLevel &&
        (!requiredScope ||
          projectAccessLevelScopes[accessLevel]?.includes(requiredScope))
      ) {
        return {
          ...castParams,
          access: {
            code: accessCode,
            level: accessLevel,
          },
        };
      }
    } catch (err) {
      console.warn("Cannot parse access code", err);
      return castParams;
    }
  }

  return castParams;
};
