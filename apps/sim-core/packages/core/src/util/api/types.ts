import { CommitActionVerb } from "./auto-types";

export type MyType<T> = { me: T };

export type Org = { id: string; name: string; shortname: string };
export type Role = { id: string; name: string; description?: string | null };
export type OrgInfo = { org: Org; role: Role; jobTitle?: string | null };
export type TourProgress = {
  completed: boolean;
  version?: string | null;
  lastStepViewed?: string | null;
};

export type BasicUser = {
  id: string;
  email: string;
  fullName: string;
  shortname: string;
  staffMember?: boolean | null;
};

export type User = BasicUser & {
  memberOf?: OrgInfo[] | null;
  role: Role;
  cloudCredits?: number | null;
  image?: string | null;
};

type HasId = { id: string };
type HasName = { name: string };
type HasDescription = { description: string };

export type Keyword = HasName & {
  count: string;
};

export type License = HasId &
  HasName &
  HasDescription & {
    url: string;
    default: boolean;
  };

export type Subject = HasId &
  HasName &
  HasDescription & {
    parent?: Subject;
    ancestors?: Subject[];
    parentChain?: string;
    layer?: "core" | "pending"; // SchemaOrgLayer
  };

export type ReleaseMeta = {
  keywords: Keyword[];
  licenses: License[];
  subjects?: Subject[];
};

export type ApiCommitAction = {
  action: CommitActionVerb;
  filePath: string;
  previousPath?: string;
  content?: string;
};
