/**
 * Registry schema for clones-cli
 * This file is shared across machines (synced via yadm or similar)
 */

export interface Registry {
  version: '1.0.0';
  repos: RegistryEntry[];
  tombstones: string[];
}

export interface RegistryEntry {
  // Identity
  id: string; // Unique stable identifier (e.g., "github.com:colinhacks/zsh")
  host: string; // github.com | gitlab.com | bitbucket.org | custom-host.com
  owner: string; // Organization or user
  repo: string; // Repository name
  cloneUrl: string; // Full HTTPS or SSH URL

  // Metadata (optional)
  description?: string;
  tags?: string[];

  // Behavior
  defaultRemoteName: string; // Usually "origin"
  updateStrategy: 'hard-reset' | 'ff-only';
  submodules: 'none' | 'recursive';
  lfs: 'auto' | 'always' | 'never';

  // Source tracking
  source?: 'manual' | 'github-star'; // Where this entry came from
  starredAt?: string; // ISO 8601 - when starred on GitHub

  // Tracking
  // State
  managed: boolean; // If false, desired but not yet cloned
}

/**
 * Local state schema for clones-cli
 * This file is machine-specific (NOT synced across machines)
 * Contains timestamps and other machine-local state
 */

export interface LocalState {
  version: '1.0.0';
  lastSyncRun?: string; // ISO 8601 - when sync was last run on this machine
  repos: {
    [repoId: string]: RepoLocalState;
  };
}

export interface RepoLocalState {
  lastSyncedAt?: string; // ISO 8601 - when this repo was last synced on this machine
}

/**
 * Result of parsing a Git URL
 */
export interface ParsedGitUrl {
  host: string;
  owner: string;
  repo: string;
  cloneUrl: string;
}

/**
 * Local status of a repository
 */
export interface RepoStatus {
  exists: boolean;
  isGitRepo: boolean;
  currentBranch: string | null;
  isDetached: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
  isDirty: boolean;
}

/**
 * Result of an update operation for a single repo
 */
export type UpdateResult =
  | { status: 'updated'; commits: number; wasDirty: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string };

/**
 * Database row for a repository in the SQLite database
 * Extends RegistryEntry with additional derived/indexed fields
 */
export interface DbRepoRow extends RegistryEntry {
  contentHash?: string; // Hash of the repository content for change detection
  readmeIndexedAt?: string; // ISO 8601 - when the README was last indexed
}

/**
 * GitHub authentication configuration
 */
export interface GitHubAuthConfig {
  token?: string;
  username?: string;
  syncStars?: boolean;
}

/**
 * GitHub Device Flow API response
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}
