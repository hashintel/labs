import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Mock the config module to use a temp directory
const testDir = join(tmpdir(), `clones-test-${randomUUID()}`);

vi.mock('../../src/lib/config.js', () => ({
  getClonesDir: () => testDir,
}));
vi.mock('../../src/lib/path-utils.js', () => ({
  isSafePathSegment: (segment: string) => segment !== 'unsafe',
}));

// Import after mocking
const { scanClonesDir, isNestedRepo } = await import('../../src/lib/scan.js');

describe('scanClonesDir', () => {
  beforeEach(async () => {
    // Create test directory structure
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty when clones dir is empty', async () => {
    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('discovers repos at depth 2 with .git directory', async () => {
    // Create owner/repo/.git structure
    await mkdir(join(testDir, 'owner1', 'repo1', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner1', 'repo2', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner2', 'repo3', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(3);
    expect(result.discovered.map((d) => `${d.owner}/${d.repo}`).sort()).toEqual([
      'owner1/repo1',
      'owner1/repo2',
      'owner2/repo3',
    ]);
  });

  it('skips directories without .git', async () => {
    await mkdir(join(testDir, 'owner', 'no-git'), { recursive: true });
    await mkdir(join(testDir, 'owner', 'has-git', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0].repo).toBe('has-git');
    expect(result.skipped.some((s) => s.path.includes('no-git'))).toBe(true);
  });

  it('skips hidden directories', async () => {
    await mkdir(join(testDir, '.hidden-owner', 'repo', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner', '.hidden-repo', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner', 'visible-repo', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0].repo).toBe('visible-repo');
  });

  it('skips unsafe owner or repo segments', async () => {
    await mkdir(join(testDir, 'unsafe', 'repo', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner', 'unsafe', '.git'), { recursive: true });
    await mkdir(join(testDir, 'owner', 'safe-repo', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0].repo).toBe('safe-repo');
    expect(result.skipped.some((s) => s.path.includes('unsafe'))).toBe(true);
  });

  it('skips registry files at root level', async () => {
    await writeFile(join(testDir, 'registry.json'), '{}');
    await writeFile(join(testDir, 'registry.toml'), 'version = "1.0.0"');
    await mkdir(join(testDir, 'owner', 'repo', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    // registry files should not appear in skipped
    expect(result.skipped.every((s) => !s.path.includes('registry.json'))).toBe(true);
    expect(result.skipped.every((s) => !s.path.includes('registry.toml'))).toBe(true);
  });

  it('handles non-directory files at owner level', async () => {
    await writeFile(join(testDir, 'random-file.txt'), 'content');
    await mkdir(join(testDir, 'owner', 'repo', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    // Files should just be ignored, not added to skipped
  });

  it('handles non-directory files at repo level', async () => {
    await mkdir(join(testDir, 'owner'), { recursive: true });
    await writeFile(join(testDir, 'owner', 'some-file.md'), 'content');
    await mkdir(join(testDir, 'owner', 'repo', '.git'), { recursive: true });

    const result = await scanClonesDir();

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0].repo).toBe('repo');
  });
});

describe('isNestedRepo', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns false for normal repo with .git directory', async () => {
    const repoPath = join(testDir, 'owner', 'repo');
    await mkdir(join(repoPath, '.git'), { recursive: true });

    const result = await isNestedRepo(repoPath);

    expect(result).toBe(false);
  });

  it('returns true when .git is a file (submodule)', async () => {
    const repoPath = join(testDir, 'owner', 'repo');
    await mkdir(repoPath, { recursive: true });
    // Submodules have a .git file, not directory
    await writeFile(join(repoPath, '.git'), 'gitdir: ../../../.git/modules/repo');

    const result = await isNestedRepo(repoPath);

    expect(result).toBe(true);
  });

  it('returns false when path does not exist', async () => {
    const result = await isNestedRepo(join(testDir, 'nonexistent'));

    expect(result).toBe(false);
  });
});
