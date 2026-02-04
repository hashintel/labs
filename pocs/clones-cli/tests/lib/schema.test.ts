import { describe, it, expect } from 'vitest';
import { normalizeRegistry, normalizeLocalState } from '../../src/lib/schema.js';

describe('normalizeRegistry', () => {
  it('drops unknown fields and defaults invalid values', () => {
    const raw = {
      version: '1.0.0',
      extra: 'field',
      tombstones: ['github.com:owner/repo', 'github.com:owner/repo', 123],
      repos: [
        {
          id: 'github.com:owner/repo',
          host: 'github.com',
          owner: 'owner',
          repo: 'repo',
          cloneUrl: 'https://github.com/owner/repo.git',
          defaultRemoteName: 'origin',
          updateStrategy: 'weird',
          submodules: 'none',
          lfs: 'auto',
          managed: 'yes',
          addedBy: 'manual',
          tags: ['ok', 42],
        },
      ],
    };

    const normalized = normalizeRegistry(raw);

    expect(normalized.data.repos[0].updateStrategy).toBe('hard-reset');
    expect(normalized.data.repos[0].managed).toBe(true);
    expect(normalized.data.repos[0].tags).toEqual(['ok']);
    expect((normalized.data.repos[0] as any).addedBy).toBeUndefined();
    expect(normalized.data.tombstones).toEqual([]);
    expect(normalized.issues.length).toBeGreaterThan(0);
  });

  it('normalizes casing and drops duplicate ids', () => {
    const raw = {
      version: '1.0.0',
      tombstones: ['GitHub.com:Owner/Repo'],
      repos: [
        {
          id: 'GitHub.com:Owner/Repo',
          host: 'GitHub.com',
          owner: 'Owner',
          repo: 'Repo',
          cloneUrl: 'https://GitHub.com/Owner/Repo.git',
          defaultRemoteName: 'origin',
          updateStrategy: 'hard-reset',
          submodules: 'none',
          lfs: 'auto',
          managed: true,
        },
        {
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
        },
      ],
    };

    const normalized = normalizeRegistry(raw);

    expect(normalized.data.repos).toHaveLength(1);
    expect(normalized.data.repos[0].id).toBe('github.com:owner/repo');
    expect(normalized.data.repos[0].host).toBe('github.com');
    expect(normalized.data.repos[0].owner).toBe('owner');
    expect(normalized.data.repos[0].repo).toBe('repo');
    expect(normalized.data.tombstones).toEqual([]);
    expect(normalized.issues.length).toBeGreaterThan(0);
  });
});

describe('normalizeLocalState', () => {
  it('drops unknown fields and invalid repo state', () => {
    const raw = {
      version: '1.0.0',
      lastSyncRun: 123,
      extra: 'field',
      repos: {
        'github.com:owner/repo': {
          lastSyncedAt: '2026-01-01T00:00:00Z',
          extraField: true,
        },
        'github.com:owner/bad': 'invalid',
      },
    };

    const normalized = normalizeLocalState(raw);

    expect(normalized.data.lastSyncRun).toBeUndefined();
    expect(normalized.data.repos['github.com:owner/repo'].lastSyncedAt).toBe(
      '2026-01-01T00:00:00Z'
    );
    expect(normalized.data.repos['github.com:owner/bad']).toBeUndefined();
    expect(normalized.issues.length).toBeGreaterThan(0);
  });

  it('normalizes repo id casing and merges duplicates', () => {
    const raw = {
      version: '1.0.0',
      repos: {
        'GitHub.com:Owner/Repo': {
          lastSyncedAt: '2026-01-01T00:00:00Z',
        },
        'github.com:owner/repo': {
          lastSyncedAt: '2026-01-02T00:00:00Z',
        },
      },
    };

    const normalized = normalizeLocalState(raw);

    expect(Object.keys(normalized.data.repos)).toEqual(['github.com:owner/repo']);
    expect(normalized.data.repos['github.com:owner/repo'].lastSyncedAt).toBe(
      '2026-01-02T00:00:00Z'
    );
    expect(normalized.issues.length).toBeGreaterThan(0);
  });
});
