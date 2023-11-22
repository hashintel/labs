import { CommitActionVerb } from "./auto-types";

export interface MyType<T> {
  me: T;
}

export interface Org {
  id: string;
  name: string;
  shortname: string;
}
export interface Role {
  id: string;
  name: string;
  description?: string | null;
}
export interface OrgInfo {
  org: Org;
  role: Role;
  jobTitle?: string | null;
}
export interface TourProgress {
  completed: boolean;
  version?: string | null;
  lastStepViewed?: string | null;
}

export interface BasicUser {
  id: string;
  email: string;
  fullName: string;
  shortname: string;
  staffMember?: boolean | null;
}

export type User = BasicUser & {
  memberOf?: OrgInfo[] | null;
  role: Role;
  cloudCredits?: number | null;
  image?: string | null;
};

interface HasId {
  id: string;
}
interface HasName {
  name: string;
}
interface HasDescription {
  description: string;
}

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

export interface ReleaseMeta {
  keywords: Keyword[];
  licenses: License[];
  subjects?: Subject[];
}

export interface ApiCommitAction {
  action: CommitActionVerb;
  filePath: string;
  previousPath?: string;
  content?: string;
}
