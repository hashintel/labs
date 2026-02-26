import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Registry, RegistryEntry } from '../types/index.js';
import {
  getLegacyRegistryPath,
  getLegacyRegistryTomlPath,
  getRegistryPath,
  ensureConfigDir,
} from './config.js';
import { normalizeRegistry } from './schema.js';

function canonicalize(value: string): string {
  return value.toLowerCase();
}

type RegistryFormat = 'jsonl' | 'toml' | 'json';

type RegistryFile = {
  path: string;
  format: RegistryFormat;
  content: string;
};

function detectRegistryFile(): { path: string; format: RegistryFormat } | null {
  const jsonlPath = getRegistryPath();
  if (existsSync(jsonlPath)) {
    return { path: jsonlPath, format: 'jsonl' };
  }

  const tomlPath = getLegacyRegistryTomlPath();
  if (existsSync(tomlPath)) {
    return { path: tomlPath, format: 'toml' };
  }

  const legacyPath = getLegacyRegistryPath();
  if (existsSync(legacyPath)) {
    return { path: legacyPath, format: 'json' };
  }

  return null;
}

export async function readRegistryFile(): Promise<RegistryFile | null> {
  const detected = detectRegistryFile();
  if (!detected) return null;

  const content = await readFile(detected.path, 'utf-8');
  return { ...detected, content };
}

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && char === '#') {
      return line.slice(0, i);
    }
  }

  return line;
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith('[')) {
    if (!trimmed.endsWith(']')) {
      throw new Error('Invalid TOML array');
    }
    const inner = trimmed.slice(1, -1).replace(/,\s*$/, '');
    return JSON.parse(`[${inner}]`);
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }

  throw new Error('Unsupported TOML value');
}

function parseRegistryJsonl(content: string): unknown {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  let version: string | undefined;
  const repos: Record<string, unknown>[] = [];
  const tombstones: string[] = [];

  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj._type === 'meta') {
      version = obj.version;
    } else if (obj._type === 'tombstone') {
      tombstones.push(obj.id);
    } else if (obj._type === 'repo') {
      const { _type, ...entry } = obj;
      repos.push(entry);
    }
  }

  return { version: version ?? '1.0.0', repos, tombstones };
}

// Minimal TOML subset parser for registry.toml (strings, string arrays, booleans, [[repos]]).
function parseRegistryToml(content: string): unknown {
  const result: Record<string, unknown> = {};
  const repos: Record<string, unknown>[] = [];
  let currentRepo: Record<string, unknown> | null = null;

  for (const rawLine of content.split('\n')) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    if (line === '[[repos]]') {
      currentRepo = {};
      repos.push(currentRepo);
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      throw new Error('Invalid TOML line');
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = parseTomlValue(line.slice(equalsIndex + 1));

    const isTopLevelKey = key === 'version' || key === 'tombstones';
    if (currentRepo && !isTopLevelKey) {
      currentRepo[key] = value;
    } else {
      result[key] = value;
    }
  }

  result.repos = repos;

  return result;
}

export function parseRegistryContent(
  content: string,
  format: RegistryFormat,
  path: string
): unknown {
  try {
    if (format === 'jsonl') return parseRegistryJsonl(content);
    if (format === 'toml') return parseRegistryToml(content);
    return JSON.parse(content);
  } catch {
    throw new Error(`Registry file is corrupted: ${path}`);
  }
}

function buildRegistryPayload(registry: Registry): Record<string, unknown> {
  const repos = registry.repos.map((entry) => {
    const repo: Record<string, unknown> = {
      id: entry.id,
      host: entry.host,
      owner: entry.owner,
      repo: entry.repo,
      cloneUrl: entry.cloneUrl,
    };

    if (entry.description !== undefined) {
      repo.description = entry.description;
    }
    if (entry.tags?.length) {
      repo.tags = entry.tags;
    }

    repo.defaultRemoteName = entry.defaultRemoteName;
    repo.updateStrategy = entry.updateStrategy;
    repo.submodules = entry.submodules;
    repo.lfs = entry.lfs;
    repo.managed = entry.managed;

    if (entry.source !== undefined) {
      repo.source = entry.source;
    }
    if (entry.starredAt !== undefined) {
      repo.starredAt = entry.starredAt;
    }

    return repo;
  });

  return {
    version: registry.version,
    repos,
    tombstones: registry.tombstones,
  };
}

export function stringifyRegistry(registry: Registry): string {
  const payload = buildRegistryPayload(registry) as {
    version: string;
    repos: Record<string, unknown>[];
    tombstones: string[];
  };

  const lines: string[] = [];

  // Meta line
  lines.push(JSON.stringify({ _type: 'meta', version: payload.version }));

  // Tombstones sorted by id
  const sortedTombstones = [...payload.tombstones].sort();
  for (const id of sortedTombstones) {
    lines.push(JSON.stringify({ _type: 'tombstone', id }));
  }

  // Repos sorted by id
  const sortedRepos = [...payload.repos].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const entry of sortedRepos) {
    lines.push(JSON.stringify({ _type: 'repo', ...entry }));
  }

  return lines.join('\n') + '\n';
}

/**
 * Create an empty registry
 */
export function createEmptyRegistry(): Registry {
  return {
    version: '1.0.0',
    repos: [],
    tombstones: [],
  };
}

/**
 * Read the registry from disk
 * Returns an empty registry if the file doesn't exist
 */
export async function readRegistry(): Promise<Registry> {
  const registryFile = await readRegistryFile();
  if (!registryFile) {
    return createEmptyRegistry();
  }

  const raw = parseRegistryContent(registryFile.content, registryFile.format, registryFile.path);
  const normalized = normalizeRegistry(raw);
  return normalized.data;
}

/**
 * Write the registry to disk atomically
 * Uses write-to-temp + rename pattern to prevent corruption
 */
export async function writeRegistry(registry: Registry): Promise<void> {
  await ensureConfigDir();

  const normalized = normalizeRegistry(registry);
  const path = getRegistryPath();
  const tempPath = join(dirname(path), `.registry.${randomUUID()}.tmp`);

  const content = stringifyRegistry(normalized.data);
  await writeFile(tempPath, content, 'utf-8');

  // Atomic rename
  await rename(tempPath, path);

  // Clean up legacy files
  for (const legacyPath of [getLegacyRegistryTomlPath(), getLegacyRegistryPath()]) {
    if (existsSync(legacyPath)) {
      try {
        await unlink(legacyPath);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/**
 * Find a registry entry by ID
 */
export function findEntry(registry: Registry, id: string): RegistryEntry | undefined {
  const normalizedId = canonicalize(id);
  return registry.repos.find((entry) => entry.id === normalizedId);
}

/**
 * Find a registry entry by owner/repo
 */
export function findEntryByOwnerRepo(
  registry: Registry,
  owner: string,
  repo: string
): RegistryEntry | undefined {
  const normalizedOwner = canonicalize(owner);
  const normalizedRepo = canonicalize(repo);
  return registry.repos.find(
    (entry) => entry.owner === normalizedOwner && entry.repo === normalizedRepo
  );
}

/**
 * Add an entry to the registry
 * Throws if an entry with the same ID already exists
 */
export function addEntry(registry: Registry, entry: RegistryEntry): Registry {
  if (findEntry(registry, entry.id)) {
    throw new Error(`Repository already exists in registry: ${entry.id}`);
  }

  return {
    ...registry,
    repos: [...registry.repos, entry],
  };
}

/**
 * Update an entry in the registry
 */
export function updateEntry(
  registry: Registry,
  id: string,
  updates: Partial<RegistryEntry>
): Registry {
  const index = registry.repos.findIndex((entry) => entry.id === id);
  if (index === -1) {
    throw new Error(`Repository not found in registry: ${id}`);
  }

  const updatedRepos = [...registry.repos];
  updatedRepos[index] = { ...updatedRepos[index], ...updates };

  return {
    ...registry,
    repos: updatedRepos,
  };
}

/**
 * Remove an entry from the registry
 */
export function removeEntry(registry: Registry, id: string): Registry {
  const filtered = registry.repos.filter((entry) => entry.id !== id);

  if (filtered.length === registry.repos.length) {
    throw new Error(`Repository not found in registry: ${id}`);
  }

  return {
    ...registry,
    repos: filtered,
  };
}

/**
 * Add an ID to tombstones (no-op if already present)
 */
export function addTombstone(registry: Registry, id: string): Registry {
  const normalizedId = canonicalize(id);
  if (registry.tombstones.includes(normalizedId)) {
    return registry;
  }

  return {
    ...registry,
    tombstones: [...registry.tombstones, normalizedId],
  };
}

/**
 * Remove an ID from tombstones (no-op if missing)
 */
export function removeTombstone(registry: Registry, id: string): Registry {
  const normalizedId = canonicalize(id);
  if (!registry.tombstones.includes(normalizedId)) {
    return registry;
  }

  return {
    ...registry,
    tombstones: registry.tombstones.filter((entryId) => entryId !== normalizedId),
  };
}

/**
 * Filter entries by tags (any match)
 */
export function filterByTags(registry: Registry, tags: string[]): RegistryEntry[] {
  if (tags.length === 0) return registry.repos;

  return registry.repos.filter((entry) => entry.tags?.some((tag) => tags.includes(tag)));
}

/**
 * Filter entries by owner/repo pattern (supports wildcards)
 * Pattern format: "owner/repo" or "owner/\*" or "\*\/repo"
 */
export function filterByPattern(registry: Registry, pattern: string): RegistryEntry[] {
  const [ownerPattern, repoPattern] = pattern.toLowerCase().split('/');

  return registry.repos.filter((entry) => {
    const ownerMatch = ownerPattern === '*' || entry.owner === ownerPattern;
    const repoMatch = !repoPattern || repoPattern === '*' || entry.repo === repoPattern;
    return ownerMatch && repoMatch;
  });
}
