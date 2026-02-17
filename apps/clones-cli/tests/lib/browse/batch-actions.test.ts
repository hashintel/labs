import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPathsForClipboard,
  formatAsJson,
  formatAsMarkdownList,
  formatAsMarkdownTable,
  type RepoInfo,
} from '../../../src/lib/browse/batch-actions.js';
import type { RegistryEntry, RepoStatus } from '../../../src/types/index.js';

// Helper to create mock registry entry
function mockEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'github.com:owner/repo',
    host: 'github.com',
    owner: 'owner',
    repo: 'repo',
    cloneUrl: 'https://github.com/owner/repo.git',
    defaultRemoteName: 'origin',
    updateStrategy: 'ff-only',
    submodules: 'none',
    lfs: 'auto',
    managed: true,
    ...overrides,
  };
}

// Helper to create mock repo status
function mockStatus(overrides: Partial<RepoStatus> = {}): RepoStatus {
  return {
    exists: true,
    isGitRepo: true,
    currentBranch: 'main',
    isDetached: false,
    tracking: 'origin/main',
    ahead: 0,
    behind: 0,
    isDirty: false,
    ...overrides,
  };
}

// Helper to create mock RepoInfo
function mockRepoInfo(
  overrides: {
    entry?: Partial<RegistryEntry>;
    status?: Partial<RepoStatus>;
    localPath?: string;
  } = {}
): RepoInfo {
  return {
    entry: mockEntry(overrides.entry),
    status: mockStatus(overrides.status),
    localPath: overrides.localPath ?? '/Users/testuser/code/owner/repo',
  };
}

describe('formatPathsForClipboard', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/Users/testuser';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('formats a single path with ~ for home', () => {
    const repos = [mockRepoInfo({ localPath: '/Users/testuser/code/foo/bar' })];
    expect(formatPathsForClipboard(repos)).toBe('~/code/foo/bar');
  });

  it('joins multiple paths with newlines', () => {
    const repos = [
      mockRepoInfo({ localPath: '/Users/testuser/code/foo/bar' }),
      mockRepoInfo({ localPath: '/Users/testuser/code/baz/qux' }),
    ];
    expect(formatPathsForClipboard(repos)).toBe('~/code/foo/bar\n~/code/baz/qux');
  });

  it('handles paths outside home directory', () => {
    const repos = [
      mockRepoInfo({ localPath: '/tmp/project' }),
      mockRepoInfo({ localPath: '/Users/testuser/code/repo' }),
    ];
    expect(formatPathsForClipboard(repos)).toBe('/tmp/project\n~/code/repo');
  });

  it('handles empty array', () => {
    expect(formatPathsForClipboard([])).toBe('');
  });
});

describe('formatAsJson', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/Users/testuser';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('formats repos as JSON array with all fields', () => {
    const repos = [
      mockRepoInfo({
        entry: {
          owner: 'foo',
          repo: 'bar',
          description: 'A test repo',
          tags: ['cli', 'typescript'],
          cloneUrl: 'https://github.com/foo/bar.git',
        },
        localPath: '/Users/testuser/code/foo/bar',
      }),
    ];
    const result = JSON.parse(formatAsJson(repos));
    expect(result).toEqual([
      {
        ownerRepo: 'foo/bar',
        path: '~/code/foo/bar',
        description: 'A test repo',
        tags: ['cli', 'typescript'],
        cloneUrl: 'https://github.com/foo/bar.git',
      },
    ]);
  });

  it('handles missing description and tags', () => {
    const repos = [
      mockRepoInfo({
        entry: { owner: 'foo', repo: 'bar', description: undefined, tags: undefined },
        localPath: '/Users/testuser/code/foo/bar',
      }),
    ];
    const result = JSON.parse(formatAsJson(repos));
    expect(result[0].description).toBeNull();
    expect(result[0].tags).toEqual([]);
  });

  it('handles multiple repos', () => {
    const repos = [
      mockRepoInfo({ entry: { owner: 'a', repo: 'b' }, localPath: '/Users/testuser/a/b' }),
      mockRepoInfo({ entry: { owner: 'c', repo: 'd' }, localPath: '/Users/testuser/c/d' }),
    ];
    const result = JSON.parse(formatAsJson(repos));
    expect(result).toHaveLength(2);
    expect(result[0].ownerRepo).toBe('a/b');
    expect(result[1].ownerRepo).toBe('c/d');
  });

  it('handles empty array', () => {
    expect(formatAsJson([])).toBe('[]');
  });
});

describe('formatAsMarkdownList', () => {
  it('formats repos as markdown list items', () => {
    const repos = [
      mockRepoInfo({ entry: { owner: 'foo', repo: 'bar' } }),
      mockRepoInfo({ entry: { owner: 'baz', repo: 'qux' } }),
    ];
    expect(formatAsMarkdownList(repos)).toBe('- foo/bar\n- baz/qux');
  });

  it('handles single repo', () => {
    const repos = [mockRepoInfo({ entry: { owner: 'foo', repo: 'bar' } })];
    expect(formatAsMarkdownList(repos)).toBe('- foo/bar');
  });

  it('handles empty array', () => {
    expect(formatAsMarkdownList([])).toBe('');
  });
});

describe('formatAsMarkdownTable', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/Users/testuser';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('formats repos as markdown table with aligned columns', () => {
    const repos = [
      mockRepoInfo({
        entry: { owner: 'foo', repo: 'bar', description: 'A test repo' },
        localPath: '/Users/testuser/code/foo/bar',
      }),
    ];
    const result = formatAsMarkdownTable(repos);
    const lines = result.split('\n');
    expect(lines[0]).toBe('| Repository | Path           | Description |');
    expect(lines[1]).toBe('| ---------- | -------------- | ----------- |');
    expect(lines[2]).toBe('| foo/bar    | ~/code/foo/bar | A test repo |');
  });

  it('handles missing description', () => {
    const repos = [
      mockRepoInfo({
        entry: { owner: 'foo', repo: 'bar', description: undefined },
        localPath: '/Users/testuser/code/foo/bar',
      }),
    ];
    const result = formatAsMarkdownTable(repos);
    const lines = result.split('\n');
    expect(lines[2]).toBe('| foo/bar    | ~/code/foo/bar |             |');
  });

  it('aligns columns across multiple repos', () => {
    const repos = [
      mockRepoInfo({
        entry: { owner: 'a', repo: 'b', description: 'First' },
        localPath: '/Users/testuser/a/b',
      }),
      mockRepoInfo({
        entry: {
          owner: 'longer-owner',
          repo: 'longer-repo',
          description: 'Second description here',
        },
        localPath: '/Users/testuser/longer-owner/longer-repo',
      }),
    ];
    const result = formatAsMarkdownTable(repos);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);

    // All lines should have same length (aligned columns)
    const lineLengths = lines.map((l) => l.length);
    expect(lineLengths[0]).toBe(lineLengths[1]);
    expect(lineLengths[0]).toBe(lineLengths[2]);
    expect(lineLengths[0]).toBe(lineLengths[3]);

    // Content should be present
    expect(lines[2]).toContain('a/b');
    expect(lines[2]).toContain('~/a/b');
    expect(lines[2]).toContain('First');
    expect(lines[3]).toContain('longer-owner/longer-repo');
    expect(lines[3]).toContain('Second description here');
  });

  it('handles empty array', () => {
    const result = formatAsMarkdownTable([]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('| Repository | Path | Description |');
    expect(lines[1]).toBe('| ---------- | ---- | ----------- |');
  });
});
