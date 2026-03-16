import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmptyRegistry,
  findEntry,
  findEntryByOwnerRepo,
  addEntry,
  updateEntry,
  removeEntry,
  addTombstone,
  removeTombstone,
  filterByTags,
  filterByPattern,
  stringifyRegistry,
  parseRegistryContent,
} from '../../src/lib/registry.js';
import type { Registry, RegistryEntry } from '../../src/types/index.js';

function createTestEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'github.com:owner/repo',
    host: 'github.com',
    owner: 'owner',
    repo: 'repo',
    cloneUrl: 'https://github.com/owner/repo.git',
    defaultRemoteName: 'origin',
    updateStrategy: 'hard-reset',
    submodules: 'none',
    lfs: 'auto',
    managed: true,
    ...overrides,
  };
}

describe('createEmptyRegistry', () => {
  it('creates registry with correct version', () => {
    const registry = createEmptyRegistry();

    expect(registry.version).toBe('1.0.0');
    expect(registry.repos).toEqual([]);
    expect(registry.tombstones).toEqual([]);
  });
});

describe('findEntry', () => {
  it('finds entry by ID', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const found = findEntry(registry, 'github.com:owner/repo');

    expect(found).toBe(entry);
  });

  it('finds entry by ID regardless of casing', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const found = findEntry(registry, 'GitHub.com:Owner/Repo');

    expect(found).toBe(entry);
  });

  it('returns undefined for unknown ID', () => {
    const registry = createEmptyRegistry();

    const found = findEntry(registry, 'github.com:unknown/repo');

    expect(found).toBeUndefined();
  });
});

describe('findEntryByOwnerRepo', () => {
  it('finds entry by owner and repo', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const found = findEntryByOwnerRepo(registry, 'owner', 'repo');

    expect(found).toBe(entry);
  });

  it('finds entry by owner and repo regardless of casing', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const found = findEntryByOwnerRepo(registry, 'Owner', 'Repo');

    expect(found).toBe(entry);
  });

  it('returns undefined for unknown owner/repo', () => {
    const registry = createEmptyRegistry();

    const found = findEntryByOwnerRepo(registry, 'unknown', 'repo');

    expect(found).toBeUndefined();
  });
});

describe('addEntry', () => {
  it('adds entry to empty registry', () => {
    const registry = createEmptyRegistry();
    const entry = createTestEntry();

    const updated = addEntry(registry, entry);

    expect(updated.repos).toHaveLength(1);
    expect(updated.repos[0]).toBe(entry);
  });

  it('throws when entry with same ID exists', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    expect(() => addEntry(registry, entry)).toThrow('Repository already exists in registry');
  });

  it('does not mutate original registry', () => {
    const registry = createEmptyRegistry();
    const entry = createTestEntry();

    const updated = addEntry(registry, entry);

    expect(registry.repos).toHaveLength(0);
    expect(updated.repos).toHaveLength(1);
  });
});

describe('updateEntry', () => {
  it('updates entry fields', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const updated = updateEntry(registry, entry.id, {
      description: 'Updated description',
      tags: ['new', 'tags'],
    });

    expect(updated.repos[0].description).toBe('Updated description');
    expect(updated.repos[0].tags).toEqual(['new', 'tags']);
  });

  it('throws for unknown ID', () => {
    const registry = createEmptyRegistry();

    expect(() => updateEntry(registry, 'unknown:id', { description: 'test' })).toThrow(
      'Repository not found in registry'
    );
  });

  it('does not mutate original registry', () => {
    const entry = createTestEntry({ description: 'original' });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const updated = updateEntry(registry, entry.id, {
      description: 'updated',
    });

    expect(registry.repos[0].description).toBe('original');
    expect(updated.repos[0].description).toBe('updated');
  });
});

describe('removeEntry', () => {
  it('removes entry by ID', () => {
    const entry = createTestEntry();
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const updated = removeEntry(registry, entry.id);

    expect(updated.repos).toHaveLength(0);
  });

  it('throws for unknown ID', () => {
    const registry = createEmptyRegistry();

    expect(() => removeEntry(registry, 'unknown:id')).toThrow('Repository not found in registry');
  });
});

describe('tombstones', () => {
  it('adds tombstone once', () => {
    const registry = createEmptyRegistry();
    const updated = addTombstone(registry, 'github.com:owner/repo');

    expect(updated.tombstones).toEqual(['github.com:owner/repo']);
    expect(addTombstone(updated, 'github.com:owner/repo').tombstones).toEqual([
      'github.com:owner/repo',
    ]);
  });

  it('normalizes tombstone casing', () => {
    const registry = createEmptyRegistry();
    const updated = addTombstone(registry, 'GitHub.com:Owner/Repo');

    expect(updated.tombstones).toEqual(['github.com:owner/repo']);
  });

  it('removes tombstone', () => {
    const registry: Registry = {
      version: '1.0.0',
      repos: [],
      tombstones: ['github.com:owner/repo'],
    };

    const updated = removeTombstone(registry, 'github.com:owner/repo');
    expect(updated.tombstones).toEqual([]);
  });
});

describe('filterByTags', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = {
      version: '1.0.0',
      repos: [
        createTestEntry({
          id: 'github.com:a/repo1',
          owner: 'a',
          repo: 'repo1',
          tags: ['cli', 'typescript'],
        }),
        createTestEntry({
          id: 'github.com:b/repo2',
          owner: 'b',
          repo: 'repo2',
          tags: ['web', 'typescript'],
        }),
        createTestEntry({
          id: 'github.com:c/repo3',
          owner: 'c',
          repo: 'repo3',
          tags: ['cli'],
        }),
        createTestEntry({
          id: 'github.com:d/repo4',
          owner: 'd',
          repo: 'repo4',
          // no tags
        }),
      ],
      tombstones: [],
    };
  });

  it('filters by single tag', () => {
    const filtered = filterByTags(registry, ['cli']);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.repo)).toEqual(['repo1', 'repo3']);
  });

  it('filters by multiple tags (OR logic)', () => {
    const filtered = filterByTags(registry, ['cli', 'web']);

    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.repo)).toEqual(['repo1', 'repo2', 'repo3']);
  });

  it('returns all repos for empty tags array', () => {
    const filtered = filterByTags(registry, []);

    expect(filtered).toHaveLength(4);
  });

  it('returns empty array when no repos match', () => {
    const filtered = filterByTags(registry, ['nonexistent']);

    expect(filtered).toHaveLength(0);
  });
});

describe('filterByPattern', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = {
      version: '1.0.0',
      repos: [
        createTestEntry({
          id: 'github.com:owner1/repo-a',
          owner: 'owner1',
          repo: 'repo-a',
        }),
        createTestEntry({
          id: 'github.com:owner1/repo-b',
          owner: 'owner1',
          repo: 'repo-b',
        }),
        createTestEntry({
          id: 'github.com:owner2/repo-a',
          owner: 'owner2',
          repo: 'repo-a',
        }),
      ],
      tombstones: [],
    };
  });

  it('matches regardless of casing', () => {
    const filtered = filterByPattern(registry, 'Owner1/Repo-A');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('github.com:owner1/repo-a');
  });

  it('filters by exact owner/repo', () => {
    const filtered = filterByPattern(registry, 'owner1/repo-a');

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('github.com:owner1/repo-a');
  });

  it('filters by owner/* wildcard', () => {
    const filtered = filterByPattern(registry, 'owner1/*');

    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.repo)).toEqual(['repo-a', 'repo-b']);
  });

  it('filters by */repo wildcard', () => {
    const filtered = filterByPattern(registry, '*/repo-a');

    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.owner)).toEqual(['owner1', 'owner2']);
  });

  it('filters by owner only', () => {
    const filtered = filterByPattern(registry, 'owner1');

    expect(filtered).toHaveLength(2);
  });

  it('returns empty for no match', () => {
    const filtered = filterByPattern(registry, 'unknown/repo');

    expect(filtered).toHaveLength(0);
  });
});

describe('JSONL serialization with source and starredAt', () => {
  it('includes source field when present', () => {
    const entry = createTestEntry({
      source: 'manual',
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const jsonl = stringifyRegistry(registry);

    expect(jsonl).toContain('"source":"manual"');
  });

  it('includes starredAt field when present', () => {
    const entry = createTestEntry({
      starredAt: '2024-01-15T10:30:00Z',
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const jsonl = stringifyRegistry(registry);

    expect(jsonl).toContain('"starredAt":"2024-01-15T10:30:00Z"');
  });

  it('omits source field when undefined', () => {
    const entry = createTestEntry({
      source: undefined,
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const jsonl = stringifyRegistry(registry);

    expect(jsonl).not.toContain('"source"');
  });

  it('omits starredAt field when undefined', () => {
    const entry = createTestEntry({
      starredAt: undefined,
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const jsonl = stringifyRegistry(registry);

    expect(jsonl).not.toContain('"starredAt"');
  });

  it('round-trip: parse JSONL with new fields and serialize again', () => {
    const entry = createTestEntry({
      source: 'github-star',
      starredAt: '2024-01-15T10:30:00Z',
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    // Serialize to JSONL
    const jsonl = stringifyRegistry(registry);

    // Parse back from JSONL
    const parsed = parseRegistryContent(jsonl, 'jsonl', 'test.jsonl');

    // Verify fields are preserved
    expect((parsed as any).repos[0].source).toBe('github-star');
    expect((parsed as any).repos[0].starredAt).toBe('2024-01-15T10:30:00Z');
  });

  it('handles both source and starredAt together', () => {
    const entry = createTestEntry({
      source: 'github-star',
      starredAt: '2024-01-15T10:30:00Z',
    });
    const registry: Registry = {
      version: '1.0.0',
      repos: [entry],
      tombstones: [],
    };

    const jsonl = stringifyRegistry(registry);

    expect(jsonl).toContain('"source":"github-star"');
    expect(jsonl).toContain('"starredAt":"2024-01-15T10:30:00Z"');
  });
});
