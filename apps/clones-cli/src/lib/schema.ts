import type { LocalState, Registry, RegistryEntry } from '../types/index.js';
import { DEFAULTS } from './config.js';

type NormalizationResult<T> = {
  data: T;
  changed: boolean;
  issues: string[];
};

const REGISTRY_ENTRY_KEYS = new Set([
  'id',
  'host',
  'owner',
  'repo',
  'cloneUrl',
  'description',
  'tags',
  'defaultRemoteName',
  'updateStrategy',
  'submodules',
  'lfs',
  'managed',
  'source',
  'starredAt',
]);

const LOCAL_STATE_KEYS = new Set(['version', 'lastSyncRun', 'repos']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalizeRepoId(id: string): string {
  return id.toLowerCase();
}

function canonicalizeRepoPart(value: string): string {
  return value.toLowerCase();
}

function pickLatestTimestamp(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid registry format (missing ${label})`);
  }
  return value;
}

function normalizeRegistryEntry(
  raw: Record<string, unknown>,
  issues: string[],
  index: number
): { entry: RegistryEntry; changed: boolean } {
  let changed = false;

  for (const key of Object.keys(raw)) {
    if (!REGISTRY_ENTRY_KEYS.has(key)) {
      issues.push(`registry.repos[${index}] dropped unknown field "${key}"`);
      changed = true;
    }
  }

  const rawId = requireString(raw.id, 'id');
  const rawHost = requireString(raw.host, 'host');
  const rawOwner = requireString(raw.owner, 'owner');
  const rawRepo = requireString(raw.repo, 'repo');
  const cloneUrl = requireString(raw.cloneUrl, 'cloneUrl');

  const host = canonicalizeRepoPart(rawHost);
  const owner = canonicalizeRepoPart(rawOwner);
  const repo = canonicalizeRepoPart(rawRepo);
  if (host !== rawHost) {
    issues.push(`registry.repos[${index}] normalized host casing`);
    changed = true;
  }
  if (owner !== rawOwner) {
    issues.push(`registry.repos[${index}] normalized owner casing`);
    changed = true;
  }
  if (repo !== rawRepo) {
    issues.push(`registry.repos[${index}] normalized repo casing`);
    changed = true;
  }

  const id = `${host}:${owner}/${repo}`;
  if (rawId !== id) {
    issues.push(`registry.repos[${index}] normalized id casing`);
    changed = true;
  }
  const defaultRemoteName =
    typeof raw.defaultRemoteName === 'string' && raw.defaultRemoteName.length > 0
      ? raw.defaultRemoteName
      : DEFAULTS.defaultRemoteName;
  if (defaultRemoteName !== raw.defaultRemoteName) {
    issues.push(`registry.repos[${index}] defaulted defaultRemoteName`);
    changed = true;
  }

  const updateStrategy =
    raw.updateStrategy === 'ff-only' || raw.updateStrategy === 'hard-reset'
      ? raw.updateStrategy
      : DEFAULTS.updateStrategy;
  if (updateStrategy !== raw.updateStrategy) {
    issues.push(`registry.repos[${index}] defaulted updateStrategy`);
    changed = true;
  }

  const submodules =
    raw.submodules === 'recursive' || raw.submodules === 'none'
      ? raw.submodules
      : DEFAULTS.submodules;
  if (submodules !== raw.submodules) {
    issues.push(`registry.repos[${index}] defaulted submodules`);
    changed = true;
  }

  const lfs =
    raw.lfs === 'auto' || raw.lfs === 'always' || raw.lfs === 'never' ? raw.lfs : DEFAULTS.lfs;
  if (lfs !== raw.lfs) {
    issues.push(`registry.repos[${index}] defaulted lfs`);
    changed = true;
  }

  const managed = typeof raw.managed === 'boolean' ? raw.managed : true;
  if (managed !== raw.managed) {
    issues.push(`registry.repos[${index}] defaulted managed`);
    changed = true;
  }

  const description = typeof raw.description === 'string' ? raw.description : undefined;

  let tags: string[] | undefined;
  if (Array.isArray(raw.tags)) {
    const filtered = raw.tags.filter((tag) => typeof tag === 'string');
    tags = filtered.length > 0 ? filtered : undefined;
    if (filtered.length !== raw.tags.length) {
      issues.push(`registry.repos[${index}] dropped non-string tags`);
      changed = true;
    }
  } else if (raw.tags !== undefined) {
    issues.push(`registry.repos[${index}] dropped invalid tags`);
    changed = true;
  }

  // Normalize source field
  const source: RegistryEntry['source'] =
    raw.source === 'manual' || raw.source === 'github-star' ? raw.source : undefined;
  if (raw.source !== undefined && source === undefined) {
    issues.push(`registry.repos[${index}] dropped invalid source`);
    changed = true;
  }

  // Normalize starredAt field
  const starredAt = typeof raw.starredAt === 'string' ? raw.starredAt : undefined;
  if (raw.starredAt !== undefined && starredAt === undefined) {
    issues.push(`registry.repos[${index}] dropped invalid starredAt`);
    changed = true;
  }

  const entry: RegistryEntry = {
    id,
    host,
    owner,
    repo,
    cloneUrl,
    description,
    tags,
    defaultRemoteName,
    updateStrategy,
    submodules,
    lfs,
    managed,
    source,
    starredAt,
  };

  return { entry, changed };
}

export function normalizeRegistry(raw: unknown): NormalizationResult<Registry> {
  if (!isRecord(raw)) {
    throw new Error('Invalid registry format');
  }

  const issues: string[] = [];
  let changed = false;

  for (const key of Object.keys(raw)) {
    if (key !== 'version' && key !== 'repos' && key !== 'tombstones') {
      issues.push(`registry dropped unknown field "${key}"`);
      changed = true;
    }
  }

  if (typeof raw.version !== 'string') {
    throw new Error('Invalid registry format');
  }

  if (!Array.isArray(raw.repos)) {
    throw new Error('Invalid registry format');
  }

  const repos: RegistryEntry[] = [];
  const seenRepoIds = new Set<string>();
  raw.repos.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid registry format (repos[${index}])`);
    }
    const normalized = normalizeRegistryEntry(entry, issues, index);
    if (normalized.changed) {
      changed = true;
    }
    if (seenRepoIds.has(normalized.entry.id)) {
      issues.push(`registry.repos[${index}] dropped duplicate repo id "${normalized.entry.id}"`);
      changed = true;
      return;
    }
    seenRepoIds.add(normalized.entry.id);
    repos.push(normalized.entry);
  });

  let tombstones: string[] = [];
  if (Array.isArray(raw.tombstones)) {
    const filtered = raw.tombstones
      .filter((entry) => typeof entry === 'string' && entry.length > 0)
      .map((entry) => {
        const canonical = canonicalizeRepoId(entry);
        if (canonical !== entry) {
          issues.push('registry normalized tombstone casing');
          changed = true;
        }
        return canonical;
      });
    if (filtered.length !== raw.tombstones.length) {
      issues.push('registry dropped invalid tombstones');
      changed = true;
    }
    tombstones = filtered;
  } else if (raw.tombstones !== undefined) {
    issues.push('registry dropped invalid tombstones');
    changed = true;
  }

  const repoIds = new Set(repos.map((entry) => entry.id));
  const withoutActive = tombstones.filter((id) => !repoIds.has(id));
  if (withoutActive.length !== tombstones.length) {
    issues.push('registry removed tombstones that are active repos');
    changed = true;
  }

  const deduped = Array.from(new Set(withoutActive));
  if (deduped.length !== withoutActive.length) {
    issues.push('registry removed duplicate tombstones');
    changed = true;
  }

  return {
    data: { version: '1.0.0', repos, tombstones: deduped },
    changed,
    issues,
  };
}

export function normalizeLocalState(raw: unknown): NormalizationResult<LocalState> {
  if (!isRecord(raw)) {
    throw new Error('Invalid local state format');
  }

  const issues: string[] = [];
  let changed = false;

  for (const key of Object.keys(raw)) {
    if (!LOCAL_STATE_KEYS.has(key)) {
      issues.push(`local.json dropped unknown field "${key}"`);
      changed = true;
    }
  }

  if (typeof raw.version !== 'string') {
    throw new Error('Invalid local state format');
  }

  if (!isRecord(raw.repos)) {
    throw new Error('Invalid local state format');
  }

  const repos: LocalState['repos'] = {};
  for (const [repoId, value] of Object.entries(raw.repos)) {
    if (!isRecord(value)) {
      issues.push(`local.json dropped invalid repo state for "${repoId}"`);
      changed = true;
      continue;
    }

    const canonicalRepoId = canonicalizeRepoId(repoId);
    if (canonicalRepoId !== repoId) {
      issues.push(`local.json normalized repo id casing for "${repoId}"`);
      changed = true;
    }

    let lastSyncedAt: string | undefined;
    if (typeof value.lastSyncedAt === 'string') {
      lastSyncedAt = value.lastSyncedAt;
    } else if (value.lastSyncedAt !== undefined) {
      issues.push(`local.json dropped invalid lastSyncedAt for "${repoId}"`);
      changed = true;
    }

    if (repos[canonicalRepoId]) {
      issues.push(`local.json merged duplicate repo state for "${canonicalRepoId}"`);
      changed = true;
      repos[canonicalRepoId] = {
        lastSyncedAt: pickLatestTimestamp(repos[canonicalRepoId].lastSyncedAt, lastSyncedAt),
      };
      continue;
    }

    repos[canonicalRepoId] = { lastSyncedAt };
  }

  let lastSyncRun: string | undefined;
  if (typeof raw.lastSyncRun === 'string') {
    lastSyncRun = raw.lastSyncRun;
  } else if (raw.lastSyncRun !== undefined) {
    issues.push('local.json dropped invalid lastSyncRun');
    changed = true;
  }

  return {
    data: {
      version: '1.0.0',
      lastSyncRun,
      repos,
    },
    changed,
    issues,
  };
}
