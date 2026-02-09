import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/lib/config.js';
import { BASE_PROFILE_SLUG } from '../src/types/index.js';

const prompts = vi.hoisted(() => ({
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  outro: vi.fn(),
}));

vi.mock('@clack/prompts', () => prompts);

function snapshotEnv(keys: string[]) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('addCommand symlink preservation', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;
  const originalExit = process.exit;

  beforeEach(async () => {
    vi.clearAllMocks();
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-add-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;

    // Setup prompt mocks
    prompts.text.mockResolvedValue('work');
    prompts.confirm.mockResolvedValue(false); // Don't switch profile
    prompts.outro.mockReturnValue(undefined);

    // Mock process.exit to throw so we can catch it
    // @ts-expect-error mock process.exit
    process.exit = vi.fn(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    // @ts-expect-error restore
    process.exit = originalExit;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('preserves internal symlinks when creating profile from _base', async () => {
    // Setup: Create _base profile with an internal symlink
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const baseDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.mkdir(baseDir, { recursive: true });

    // Create a regular file
    await fs.writeFile(path.join(baseDir, 'config.txt'), 'base config');

    // Create a target file for the symlink
    await fs.writeFile(path.join(baseDir, 'shared-config.txt'), 'shared content');

    // Create an internal symlink (relative path)
    const symlinkPath = path.join(baseDir, 'link-to-shared.txt');
    await fs.symlink('./shared-config.txt', symlinkPath);

    // Create meta.json
    const metaPath = path.join(baseDir, 'meta.json');
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          name: '_base',
          slug: '_base',
          agent: 'claude',
          created_at: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // Act: Create a new profile from _base
    const { addCommand } = await import('../src/commands/add.js');
    await addCommand('claude', 'work');

    // Assert: Verify the new profile has the symlink preserved
    const newProfileDir = path.join(contentDir, 'claude', 'work');
    const newSymlinkPath = path.join(newProfileDir, 'link-to-shared.txt');

    // Check that the symlink exists and is a symlink (not a regular file)
    const stat = await fs.lstat(newSymlinkPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // Check that the symlink target is correct
    const target = await fs.readlink(newSymlinkPath);
    expect(target).toBe('./shared-config.txt');

    // Check that regular files were copied
    const configContent = await fs.readFile(path.join(newProfileDir, 'config.txt'), 'utf-8');
    expect(configContent).toBe('base config');

    // Check that meta.json was overwritten with new profile metadata
    const newMeta = JSON.parse(await fs.readFile(path.join(newProfileDir, 'meta.json'), 'utf-8'));
    expect(newMeta.name).toBe('work');
    expect(newMeta.slug).toBe('work');
    expect(newMeta.agent).toBe('claude');
  });
});
