import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG, SHARED_DIRECTORIES } from '../src/types/index.js';
import * as symlinkModule from '../src/lib/symlink.js';

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

describe('ConfigManager contentDir resolution', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'XDG_CONFIG_HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-config-test-'));
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('uses config.json contentDir (relative) when set', async () => {
    const configDir = path.join(tmpRoot, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir: 'content' }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();
    await config.init();

    expect(config.getContentDir()).toBe(path.join(configDir, 'content'));
  });

  it('AGENTPROFILES_CONTENT_DIR overrides config.json contentDir', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const overrideDir = path.join(tmpRoot, 'override');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir: 'content' }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = overrideDir;

    const config = new ConfigManager();
    await config.init();

    expect(config.getContentDir()).toBe(overrideDir);
  });

  it('ensureConfigDir loads existing config.json and creates tool dirs under contentDir', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const contentDir = path.join(tmpRoot, 'content');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();
    await config.ensureConfigDir();

    expect(config.getContentDir()).toBe(contentDir);

    for (const agent of Object.keys(SUPPORTED_TOOLS)) {
      await expect(fs.access(path.join(contentDir, agent))).resolves.toBeUndefined();
    }
  });

  it('setContentDir persists contentDir to config.json', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const contentDir = path.join(tmpRoot, 'content');

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set a custom content directory
    await config.setContentDir(contentDir);

    // Verify it's in memory
    expect(config.getContentDir()).toBe(contentDir);

    // Verify it was written to config.json
    const configPath = path.join(configDir, 'config.json');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const savedConfig = JSON.parse(configContent);
    expect(savedConfig.contentDir).toBe(contentDir);

    // Create a new ConfigManager instance and verify it loads the contentDir from config.json
    const config2 = new ConfigManager();
    await config2.init();
    expect(config2.getContentDir()).toBe(contentDir);
  });
});

describe('ConfigManager symlink-based profile management', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-symlink-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('getSymlinkStatus returns "unmanaged" for real directory', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real directory at the global path
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });

    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('unmanaged');
  });

  it('getSymlinkStatus returns "missing" when directory does not exist', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('missing');
  });

  it('adoptExisting moves real directory to _base and creates symlink back', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real directory with some content
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');

    // Adopt it
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Check that _base profile exists with the content
    const baseProfileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    const settingsFile = path.join(baseProfileDir, 'settings.json');
    await expect(fs.readFile(settingsFile, 'utf-8')).resolves.toBe('{"key":"value"}');

    // Check that meta.json exists and has correct content
    const metaFile = path.join(baseProfileDir, 'meta.json');
    const metaContent = await fs.readFile(metaFile, 'utf-8');
    const meta = JSON.parse(metaContent);
    expect(meta.name).toBe(BASE_PROFILE_SLUG);
    expect(meta.slug).toBe(BASE_PROFILE_SLUG);
    expect(meta.agent).toBe('claude');
    expect(meta.description).toBe('Base profile (adopted from original config)');
    expect(meta.created_at).toBeDefined();

    // Check that global path is now a symlink
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // Check that symlink points to _base
    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');
  });

  it('adoptExisting throws if directory is not unmanaged', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real directory
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });

    // Adopt it once
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Try to adopt again (should fail)
    await expect(config.adoptExisting('claude', BASE_PROFILE_SLUG)).rejects.toThrow(
      /Cannot adopt.*status is 'active'/
    );
  });

  it('switchProfile atomically swaps symlink to different profile', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"base":true}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Create another profile
    const workProfileDir = path.join(contentDir, 'claude', 'work');
    await fs.mkdir(workProfileDir, { recursive: true });
    await fs.writeFile(path.join(workProfileDir, 'settings.json'), '{"work":true}');

    // Switch to work profile
    await config.switchProfile('claude', 'work');

    // Verify symlink now points to work
    const activeProfile = await config.getActiveProfile('claude');
    expect(activeProfile).toBe('work');

    // Verify we can read work settings
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('getActiveProfile returns null when not managed', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const activeProfile = await config.getActiveProfile('claude');
    expect(activeProfile).toBeNull();
  });

  it('getActiveProfile returns profile slug when managed', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    const activeProfile = await config.getActiveProfile('claude');
    expect(activeProfile).toBe(BASE_PROFILE_SLUG);
  });

  it('unlinkProfile moves profile back to global location', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Unlink it
    await config.unlinkProfile('claude');

    // Check that global path is now a real directory
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);

    // Check that content is preserved
    const settingsFile = path.join(globalPath, 'settings.json');
    await expect(fs.readFile(settingsFile, 'utf-8')).resolves.toBe('{"key":"value"}');

    // Check that status is now unmanaged
    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('unmanaged');
  });

  it('getSharedDirStatus returns "unmanaged" for real directory', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real shared directory
    const globalPath = path.join(tmpHome, '.agents');
    await fs.mkdir(globalPath, { recursive: true });

    const status = await config.getSharedDirStatus('agents');
    expect(status).toBe('unmanaged');
  });

  it('adoptSharedDir moves directory and creates symlink back', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real shared directory with content
    const globalPath = path.join(tmpHome, '.agents');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'test.txt'), 'shared content');

    // Adopt it
    await config.adoptSharedDir('agents');

    // Check that content dir has the directory
    const contentPath = path.join(contentDir, '_agents');
    const testFile = path.join(contentPath, 'test.txt');
    await expect(fs.readFile(testFile, 'utf-8')).resolves.toBe('shared content');

    // Check that global path is now a symlink
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(true);

    // Check status
    const status = await config.getSharedDirStatus('agents');
    expect(status).toBe('active');
  });

  it('unlinkSharedDir moves directory back to global location', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt shared directory
    const globalPath = path.join(tmpHome, '.agents');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'test.txt'), 'shared content');
    await config.adoptSharedDir('agents');

    // Unlink it
    await config.unlinkSharedDir('agents');

    // Check that global path is now a real directory
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);

    // Check that content is preserved
    const testFile = path.join(globalPath, 'test.txt');
    await expect(fs.readFile(testFile, 'utf-8')).resolves.toBe('shared content');

    // Check status
    const status = await config.getSharedDirStatus('agents');
    expect(status).toBe('unmanaged');
  });
});

describe('release command flow', () => {
  const ENV_KEYS = [
    'AGENTPROFILES_CONFIG_DIR',
    'AGENTPROFILES_CONTENT_DIR',
    'XDG_CONFIG_HOME',
    'HOME',
  ];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-release-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    await fs.mkdir(tmpHome, { recursive: true });

    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = path.join(tmpRoot, 'config');
    process.env.AGENTPROFILES_CONTENT_DIR = path.join(tmpRoot, 'content');
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('unlinkProfile moves profile back to global location', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Verify it's managed
    let status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');

    // Release the agent
    await config.unlinkProfile('claude');

    // Verify it's now unmanaged
    status = await config.getSymlinkStatus('claude');
    expect(status).toBe('unmanaged');

    // Verify content is preserved
    const settingsFile = path.join(globalPath, 'settings.json');
    const content = await fs.readFile(settingsFile, 'utf-8');
    expect(content).toBe('{"key":"value"}');
  });
});

describe('batch profile switching', () => {
  const ENV_KEYS = [
    'AGENTPROFILES_CONFIG_DIR',
    'AGENTPROFILES_CONTENT_DIR',
    'XDG_CONFIG_HOME',
    'HOME',
  ];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-batch-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('switchProfile works for multiple agents in sequence', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set up two agents with profiles
    const agents = ['claude', 'codex'];
    for (const agent of agents) {
      const globalPath = path.join(tmpHome, SUPPORTED_TOOLS[agent].globalConfigDir);
      await fs.mkdir(globalPath, { recursive: true });
      await config.adoptExisting(agent, BASE_PROFILE_SLUG);

      // Create a 'work' profile
      const workProfileDir = path.join(contentDir, agent, 'work');
      await fs.mkdir(workProfileDir, { recursive: true });
      await fs.writeFile(
        path.join(workProfileDir, 'meta.json'),
        JSON.stringify({ name: 'work', slug: 'work', agent }, null, 2)
      );
    }

    // Switch both agents to 'work' profile
    for (const agent of agents) {
      await config.switchProfile(agent, 'work');
    }

    // Verify both are now on 'work'
    for (const agent of agents) {
      const activeProfile = await config.getActiveProfile(agent);
      expect(activeProfile).toBe('work');
    }
  });

  it('handles missing profiles gracefully', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set up one agent
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Try to switch to non-existent profile
    await expect(config.switchProfile('claude', 'nonexistent')).rejects.toThrow(/does not exist/);
  });
});

describe('adoption rollback safety', () => {
  const ENV_KEYS = [
    'AGENTPROFILES_CONFIG_DIR',
    'AGENTPROFILES_CONTENT_DIR',
    'XDG_CONFIG_HOME',
    'HOME',
  ];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-rollback-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rolls back directory move if symlink creation fails', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real directory with content
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');

    // Mock atomicSymlink to throw an error
    const originalAtomicSymlink = symlinkModule.atomicSymlink;
    vi.spyOn(symlinkModule, 'atomicSymlink').mockRejectedValueOnce(
      new Error('Simulated symlink creation failure')
    );

    // Try to adopt - should fail and rollback
    await expect(config.adoptExisting('claude', BASE_PROFILE_SLUG)).rejects.toThrow(
      /Simulated symlink creation failure/
    );

    // Verify the directory was rolled back to original location
    const stat = await fs.lstat(globalPath);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);

    // Verify content is still there
    const settingsFile = path.join(globalPath, 'settings.json');
    const content = await fs.readFile(settingsFile, 'utf-8');
    expect(content).toBe('{"key":"value"}');

    // Verify profile directory was not created
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await expect(fs.access(profileDir)).rejects.toThrow();

    // Restore original function
    vi.mocked(symlinkModule.atomicSymlink).mockRestore();
  });

  it('verifyAdoption returns true when symlink is correct', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt a profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Verify adoption
    const verified = await config.verifyAdoption('claude', BASE_PROFILE_SLUG);
    expect(verified).toBe(true);
  });

  it('verifyAdoption returns false when symlink is missing', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Don't create any symlink
    const verified = await config.verifyAdoption('claude', BASE_PROFILE_SLUG);
    expect(verified).toBe(false);
  });

  it('verifyAdoption returns false when symlink points to wrong location', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a profile directory
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.mkdir(profileDir, { recursive: true });

    // Create a symlink pointing to wrong location
    const wrongDir = path.join(contentDir, 'claude', 'wrong');
    await fs.mkdir(wrongDir, { recursive: true });

    const globalPath = path.join(tmpHome, '.claude');
    await fs.symlink(wrongDir, globalPath);

    // Verify should return false
    const verified = await config.verifyAdoption('claude', BASE_PROFILE_SLUG);
    expect(verified).toBe(false);
  });
});

describe('doctor command - broken symlink detection', () => {
  const ENV_KEYS = [
    'AGENTPROFILES_CONFIG_DIR',
    'AGENTPROFILES_CONTENT_DIR',
    'XDG_CONFIG_HOME',
    'HOME',
  ];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-doctor-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects broken symlinks', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set up an agent with a profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Verify it's active
    let status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');

    // Delete the profile directory to break the symlink
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.rm(profileDir, { recursive: true });

    // Verify it's now broken
    status = await config.getSymlinkStatus('claude');
    expect(status).toBe('broken');
  });

  it('can fix broken symlinks by removing them', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set up an agent with a profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Delete the profile directory to break the symlink
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.rm(profileDir, { recursive: true });

    // Verify it's broken
    let status = await config.getSymlinkStatus('claude');
    expect(status).toBe('broken');

    // Remove the broken symlink
    await fs.unlink(globalPath);

    // Verify it's now missing
    status = await config.getSymlinkStatus('claude');
    expect(status).toBe('missing');
  });
});
