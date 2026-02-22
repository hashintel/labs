import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/lib/config.js';
import {
  SUPPORTED_TOOLS,
  BASE_PROFILE_SLUG,
  SHARED_DIRECTORIES,
  SHARED_PROFILE_SLUG,
} from '../src/types/index.js';
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

  it('ignores XDG_CONFIG_HOME for config dir unless AGENTPROFILES_CONFIG_DIR is set', async () => {
    process.env.XDG_CONFIG_HOME = path.join(tmpRoot, 'xdg');
    delete process.env.AGENTPROFILES_CONFIG_DIR;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();

    expect(config.getConfigDir()).toBe(path.join(os.homedir(), '.config', 'agentprofiles'));
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

  it('writes claude gitignore with deny-all + include allowlist', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const contentDir = path.join(tmpRoot, 'content');

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;

    const config = new ConfigManager();
    await config.ensureConfigDir();

    const gitignorePath = path.join(contentDir, 'claude', '.gitignore');
    const gitignore = await fs.readFile(gitignorePath, 'utf-8');
    // New deny-all / allowlist format with star-slash prefix for profile depth
    expect(gitignore).toContain('*');
    expect(gitignore).toContain('!*/settings.json');
    expect(gitignore).toContain('!*/CLAUDE.md');
    expect(gitignore).toContain('!*/meta.json');
    expect(gitignore).not.toContain('_shared/');
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

  it('ensureBaseProfileLayout creates _base profile scaffolds for include agents', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const contentDir = path.join(tmpRoot, 'content');

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;

    const config = new ConfigManager();
    await config.ensureConfigDir();
    await config.ensureBaseProfileLayout('claude');

    const baseDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);

    // meta.json is written to _base
    await expect(fs.access(path.join(baseDir, 'meta.json'))).resolves.toBeUndefined();

    // .profileinclude is written to the agent content dir
    await expect(
      fs.access(path.join(contentDir, 'claude', '.profileinclude'))
    ).resolves.toBeUndefined();

    // Dir entries from the include list are scaffolded with .gitkeep
    const agentsDirStat = await fs.lstat(path.join(baseDir, 'agents'));
    expect(agentsDirStat.isDirectory()).toBe(true);
    await expect(fs.access(path.join(baseDir, 'agents', '.gitkeep'))).resolves.toBeUndefined();

    // No _shared directory is created for include agents
    await expect(fs.access(path.join(contentDir, 'claude', SHARED_PROFILE_SLUG))).rejects.toThrow();
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

  it('adoptExisting (include strategy) moves allow-listed entries to _base and symlinks back', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create a real directory with some allow-listed content
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');

    // Adopt it
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    const baseProfileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);

    // settings.json moved to _base
    await expect(fs.readFile(path.join(baseProfileDir, 'settings.json'), 'utf-8')).resolves.toBe(
      '{"key":"value"}'
    );

    // meta.json written to _base
    const meta = JSON.parse(await fs.readFile(path.join(baseProfileDir, 'meta.json'), 'utf-8'));
    expect(meta.name).toBe(BASE_PROFILE_SLUG);
    expect(meta.agent).toBe('claude');
    expect(meta.description).toBe('Base profile (adopted from original config)');

    // globalPath is still a real directory
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);

    // globalPath/settings.json is now a symlink pointing into _base
    const entryStat = await fs.lstat(path.join(globalPath, 'settings.json'));
    expect(entryStat.isSymbolicLink()).toBe(true);

    // Status is active
    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');
  });

  it('adoptExisting (include strategy) scaffolds missing dir entries with .gitkeep', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"theme":"light"}');
    // No agents/, skills/, commands/, hooks/ dirs exist yet

    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    const baseDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);

    // Dir entries are scaffolded with .gitkeep
    for (const dir of ['agents', 'skills', 'commands', 'hooks']) {
      await expect(fs.access(path.join(baseDir, dir, '.gitkeep'))).resolves.toBeUndefined();
      // symlink exists in globalPath pointing to the dir in _base
      const linkStat = await fs.lstat(path.join(globalPath, dir));
      expect(linkStat.isSymbolicLink()).toBe(true);
    }

    // settings.json is a real file in _base (moved there)
    const settingsStat = await fs.lstat(path.join(baseDir, 'settings.json'));
    expect(settingsStat.isSymbolicLink()).toBe(false);

    // No _shared directory
    await expect(fs.access(path.join(contentDir, 'claude', SHARED_PROFILE_SLUG))).rejects.toThrow();
  });

  it('adoptExisting throws if _base profile already exists (include strategy)', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });

    // Adopt it once
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Try to adopt again — fails because _base already exists
    await expect(config.adoptExisting('claude', BASE_PROFILE_SLUG)).rejects.toThrow(
      /profile '_base' already exists/
    );
  });

  it('switchProfile (include strategy) repoints per-entry symlinks', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"base":true}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Create another profile with settings.json
    const workProfileDir = path.join(contentDir, 'claude', 'work');
    await fs.mkdir(workProfileDir, { recursive: true });
    await fs.writeFile(
      path.join(workProfileDir, 'meta.json'),
      JSON.stringify({ name: 'work', slug: 'work', agent: 'claude' })
    );
    await fs.writeFile(path.join(workProfileDir, 'settings.json'), '{"work":true}');

    // Switch to work profile
    await config.switchProfile('claude', 'work');

    // Active profile is now 'work'
    const activeProfile = await config.getActiveProfile('claude');
    expect(activeProfile).toBe('work');

    // globalPath is still a real directory (not a symlink)
    const stat = await fs.lstat(globalPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);

    // globalPath/settings.json now symlinks to work/settings.json
    const entryStat = await fs.lstat(path.join(globalPath, 'settings.json'));
    expect(entryStat.isSymbolicLink()).toBe(true);
    const entryContent = await fs.readFile(path.join(globalPath, 'settings.json'), 'utf-8');
    expect(entryContent).toBe('{"work":true}');
  });

  it('getProfiles excludes reserved shared directory', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const claudeDir = path.join(contentDir, 'claude');
    await fs.mkdir(path.join(claudeDir, SHARED_PROFILE_SLUG), { recursive: true });

    const workDir = path.join(claudeDir, 'work');
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'meta.json'),
      JSON.stringify({ name: 'Work', slug: 'work', agent: 'claude' }, null, 2)
    );

    const profiles = await config.getProfiles('claude');

    expect(profiles.some((profile) => profile.slug === SHARED_PROFILE_SLUG)).toBe(false);
    expect(profiles.some((profile) => profile.slug === 'work')).toBe(true);
  });

  it('switchProfile rejects reserved shared directory', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    await expect(config.switchProfile('claude', SHARED_PROFILE_SLUG)).rejects.toThrow(
      /reserved and cannot be activated/
    );
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

  it('unlinkProfile (include strategy) restores entries to global dir and removes _base', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Create and adopt base profile with settings.json
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // globalPath/settings.json should be a symlink now
    expect((await fs.lstat(path.join(globalPath, 'settings.json'))).isSymbolicLink()).toBe(true);

    // Release
    await config.unlinkProfile('claude');

    // globalPath/settings.json is now a real file
    const settingsFile = path.join(globalPath, 'settings.json');
    const settingsStat = await fs.lstat(settingsFile);
    expect(settingsStat.isSymbolicLink()).toBe(false);
    await expect(fs.readFile(settingsFile, 'utf-8')).resolves.toBe('{"key":"value"}');

    // _base profile directory was removed
    await expect(fs.access(path.join(contentDir, 'claude', BASE_PROFILE_SLUG))).rejects.toThrow();

    // Status is now unmanaged (no _base = not managed)
    const status = await config.getSymlinkStatus('claude');
    expect(status).toBe('unmanaged');
  });

  it('unlinkProfile (include strategy) restores dir entries as real dirs', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(path.join(globalPath, 'agents'), { recursive: true });
    await fs.writeFile(path.join(globalPath, 'agents', 'test.md'), 'content');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // agents/ should be a symlink now
    expect((await fs.lstat(path.join(globalPath, 'agents'))).isSymbolicLink()).toBe(true);

    await config.unlinkProfile('claude');

    // agents/ is now a real directory
    const agentsStat = await fs.lstat(path.join(globalPath, 'agents'));
    expect(agentsStat.isDirectory()).toBe(true);
    expect(agentsStat.isSymbolicLink()).toBe(false);

    // _base removed
    await expect(fs.access(path.join(contentDir, 'claude', BASE_PROFILE_SLUG))).rejects.toThrow();
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

  it('findBrokenSymlinks recursively detects broken links in managed content', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const agentDir = path.join(contentDir, 'claude', 'work');
    await fs.mkdir(agentDir, { recursive: true });

    const validTarget = path.join(agentDir, 'settings.json');
    const validLink = path.join(agentDir, 'settings-link.json');
    await fs.writeFile(validTarget, '{}');
    await fs.symlink('./settings.json', validLink);

    const brokenLink = path.join(agentDir, 'missing-link.json');
    await fs.symlink('./does-not-exist.json', brokenLink);

    const broken = await config.findBrokenSymlinks(contentDir);

    expect(broken.length).toBe(1);
    expect(broken[0]?.linkPath).toBe(brokenLink);
    expect(broken[0]?.target).toBe('./does-not-exist.json');
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

  it('unlinkProfile (include strategy) releases agent and preserves content', async () => {
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

    // Verify content is preserved as real file
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

  it('adoptExisting (include strategy) does not clobber existing symlinks in global dir', async () => {
    // Include strategy skips pre-existing symlinks rather than double-linking them
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{"key":"value"}');

    // Pre-create a symlink at globalPath/CLAUDE.md pointing to an external target
    const externalTarget = path.join(tmpRoot, 'external-CLAUDE.md');
    await fs.writeFile(externalTarget, '# external');
    await fs.symlink(externalTarget, path.join(globalPath, 'CLAUDE.md'));

    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Existing symlink should be left untouched (still points to external target)
    const claudeStat = await fs.lstat(path.join(globalPath, 'CLAUDE.md'));
    expect(claudeStat.isSymbolicLink()).toBe(true);
    const target = await fs.readlink(path.join(globalPath, 'CLAUDE.md'));
    expect(target).toBe(externalTarget);

    // settings.json (real file) was moved to _base and symlinked back
    expect((await fs.lstat(path.join(globalPath, 'settings.json'))).isSymbolicLink()).toBe(true);
    const baseDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await expect(fs.readFile(path.join(baseDir, 'settings.json'), 'utf-8')).resolves.toBe(
      '{"key":"value"}'
    );
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

  it('detects broken per-entry symlinks (include strategy)', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    // Set up an agent with a profile
    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Verify it's active
    let status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');

    // Delete the target of a per-entry symlink to break it
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.rm(path.join(profileDir, 'settings.json'));

    // Verify it's now broken
    status = await config.getSymlinkStatus('claude');
    expect(status).toBe('broken');
  });

  it('removing broken symlink entry restores active status (include strategy)', async () => {
    const config = new ConfigManager();
    await config.ensureConfigDir();

    const globalPath = path.join(tmpHome, '.claude');
    await fs.mkdir(globalPath, { recursive: true });
    await fs.writeFile(path.join(globalPath, 'settings.json'), '{}');
    await config.adoptExisting('claude', BASE_PROFILE_SLUG);

    // Break the settings.json symlink
    const profileDir = path.join(contentDir, 'claude', BASE_PROFILE_SLUG);
    await fs.rm(path.join(profileDir, 'settings.json'));

    let status = await config.getSymlinkStatus('claude');
    expect(status).toBe('broken');

    // Remove the broken symlink from globalPath
    await fs.unlink(path.join(globalPath, 'settings.json'));

    // Status goes back to active (other entries still exist, _base still exists)
    status = await config.getSymlinkStatus('claude');
    expect(status).toBe('active');
  });
});
