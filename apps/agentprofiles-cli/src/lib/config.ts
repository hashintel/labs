import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CliConfig,
  Meta,
  SUPPORTED_TOOLS,
  SHARED_DIRECTORIES,
  BASE_PROFILE_SLUG,
  SHARED_PROFILE_SLUG,
} from '../types/index.js';
import { validateNewProfileName, slugify, validateSlug } from './validation.js';
import { getAgentGitignore } from './gitignore.js';
import {
  readSymlinkTarget,
  isSymlink,
  atomicSymlink,
  moveDirectory,
  copyDirectory,
} from './symlink.js';

// Resolution order for contentDir:
// 1. AGENTPROFILES_CONTENT_DIR environment variable
// 2. config.json contentDir setting
// 3. Default: same as configDir

export type SymlinkStatus = 'active' | 'unmanaged' | 'missing' | 'broken' | 'external';

type SharedEntryKind = 'file' | 'dir';

interface SharedEntryDefinition {
  path: string;
  kind: SharedEntryKind;
}

interface AgentLayoutDefinition {
  sharedEntries: SharedEntryDefinition[];
}

interface ManagedSymlinkSnapshot {
  relativePath: string;
  sourceResolvedTarget: string;
}

export interface BrokenSymlink {
  linkPath: string;
  target: string;
}

const AGENT_LAYOUTS: Partial<Record<keyof typeof SUPPORTED_TOOLS, AgentLayoutDefinition>> = {
  claude: {
    sharedEntries: [
      { path: 'cache', kind: 'dir' },
      { path: 'debug', kind: 'dir' },
      { path: 'downloads', kind: 'dir' },
      { path: 'file-history', kind: 'dir' },
      { path: 'history.jsonl', kind: 'file' },
      { path: 'ide', kind: 'dir' },
      { path: 'paste-cache', kind: 'dir' },
      { path: 'plans', kind: 'dir' },
      { path: 'projects', kind: 'dir' },
      { path: 'session-env', kind: 'dir' },
      { path: 'shell-snapshots', kind: 'dir' },
      { path: 'stats-cache.json', kind: 'file' },
      { path: 'statsig', kind: 'dir' },
      { path: 'todos', kind: 'dir' },
    ],
  },
  codex: {
    sharedEntries: [
      { path: '.codex-global-state.json', kind: 'file' },
      { path: '.personality_migration', kind: 'file' },
      { path: 'archived_sessions', kind: 'dir' },
      { path: 'auth.json', kind: 'file' },
      { path: 'history.jsonl', kind: 'file' },
      { path: 'internal_storage.json', kind: 'file' },
      { path: 'models_cache.json', kind: 'file' },
      { path: 'sessions', kind: 'dir' },
      { path: 'sqlite', kind: 'dir' },
      { path: 'vendor_imports', kind: 'dir' },
      { path: 'version.json', kind: 'file' },
    ],
  },
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSubpath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function copyPathDereferenced(sourcePath: string, destinationPath: string): Promise<void> {
  const linkStat = await fs.lstat(sourcePath);
  if (linkStat.isSymbolicLink()) {
    const linkTarget = await fs.readlink(sourcePath);
    const resolvedTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(sourcePath), linkTarget);
    await copyPathDereferenced(resolvedTarget, destinationPath);
    return;
  }

  if (linkStat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const childSource = path.join(sourcePath, entry.name);
      const childDestination = path.join(destinationPath, entry.name);
      await copyPathDereferenced(childSource, childDestination);
    }
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EXDEV') {
      const stat = await fs.lstat(sourcePath);
      if (stat.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath);
      } else {
        await copyPathDereferenced(sourcePath, destinationPath);
      }
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

function getDefaultConfigDir(): string {
  // AGENTPROFILES_CONFIG_DIR overrides everything
  if (process.env.AGENTPROFILES_CONFIG_DIR) {
    return process.env.AGENTPROFILES_CONFIG_DIR;
  }
  return path.join(os.homedir(), '.config', 'agentprofiles');
}

export class ConfigManager {
  private configDir: string;
  private contentDir: string;
  private tools: typeof SUPPORTED_TOOLS;
  private cliConfig: CliConfig | null = null;

  constructor() {
    this.configDir = getDefaultConfigDir();
    this.tools = SUPPORTED_TOOLS;
    // contentDir will be resolved lazily or after loading config
    this.contentDir = this.resolveContentDir();
  }

  private resolveContentDir(): string {
    // 1. Environment variable takes precedence
    if (process.env.AGENTPROFILES_CONTENT_DIR) {
      return process.env.AGENTPROFILES_CONTENT_DIR;
    }
    // 2. Config file setting (if loaded)
    if (this.cliConfig?.contentDir) {
      const configuredDir = this.cliConfig.contentDir;
      // If relative path, resolve relative to configDir
      if (!path.isAbsolute(configuredDir)) {
        return path.join(this.configDir, configuredDir);
      }
      return configuredDir;
    }
    // 3. Default: same as configDir
    return this.configDir;
  }

  private async loadCliConfig(): Promise<CliConfig> {
    const configPath = path.join(this.configDir, 'config.json');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content) as CliConfig;
    } catch {
      return {};
    }
  }

  async init(): Promise<void> {
    this.cliConfig = await this.loadCliConfig();
    this.contentDir = this.resolveContentDir();
  }

  private async saveConfig(): Promise<void> {
    const configPath = path.join(this.configDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(this.cliConfig || {}, null, 2));
  }

  getConfigDir(): string {
    return this.configDir;
  }

  getContentDir(): string {
    return this.contentDir;
  }

  async setContentDir(contentDir: string): Promise<void> {
    if (!this.cliConfig) {
      this.cliConfig = {};
    }
    this.cliConfig.contentDir = contentDir;
    this.contentDir = contentDir;
    await this.saveConfig();
  }

  async ensureConfigDir(): Promise<void> {
    // Create base config directory
    await fs.mkdir(this.configDir, { recursive: true });

    // Create config.json if not exists
    const configPath = path.join(this.configDir, 'config.json');
    try {
      await fs.access(configPath);
      // If config already exists, load it so contentDir reflects config.json.
      this.cliConfig = await this.loadCliConfig();
    } catch {
      const defaultConfig: CliConfig = {};
      await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
      this.cliConfig = defaultConfig;
    }

    // Re-resolve content dir after loading/creating config.json.
    this.contentDir = this.resolveContentDir();

    // Create content directory (may be same as configDir)
    await fs.mkdir(this.contentDir, { recursive: true });

    // Create tool directories inside content dir
    for (const tool of Object.keys(this.tools)) {
      const toolDir = path.join(this.contentDir, tool);
      await fs.mkdir(toolDir, { recursive: true });
      await this.ensureAgentGitignore(toolDir, tool);
    }
  }

  private async ensureAgentGitignore(agentDir: string, agent: string) {
    const gitignorePath = path.join(agentDir, '.gitignore');
    try {
      await fs.access(gitignorePath);
      return;
    } catch {
      // continue
    }
    const content = getAgentGitignore(agent);
    if (!content) return;
    await fs.writeFile(gitignorePath, content);
  }

  async getProfiles(agent: string): Promise<Meta[]> {
    const agentDir = path.join(this.contentDir, agent);
    try {
      const entries = await fs.readdir(agentDir, { withFileTypes: true });
      const profiles: Meta[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        if (dirName === SHARED_PROFILE_SLUG) continue;
        if (validateSlug(dirName) !== null) continue;

        const metaPath = path.join(agentDir, dirName, 'meta.json');
        let meta: Partial<Meta> = {};
        try {
          const content = await fs.readFile(metaPath, 'utf-8');
          meta = JSON.parse(content);
        } catch {
          // No meta.json or invalid JSON - use defaults
        }

        profiles.push({
          name: meta.name || dirName,
          slug: dirName,
          agent,
          description: meta.description,
          created_at: meta.created_at,
        });
      }
      return profiles;
    } catch {
      return [];
    }
  }

  async createProfile(agent: string, name: string, description?: string): Promise<string> {
    if (!this.tools[agent]) {
      throw new Error(`Unsupported agent: ${agent}`);
    }
    const validationError = validateNewProfileName(name);
    if (validationError) {
      throw new Error(validationError);
    }

    const slug = slugify(name);
    const profileDir = path.join(this.contentDir, agent, slug);

    try {
      await fs.access(profileDir);
      throw new Error(`Profile '${slug}' already exists for agent '${agent}'`);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
      if (err instanceof Error && !('code' in err)) {
        throw err;
      }
    }

    await fs.mkdir(profileDir, { recursive: true });

    const meta: Meta = {
      name,
      slug,
      agent,
      description,
      created_at: new Date().toISOString(),
    };

    await fs.writeFile(path.join(profileDir, 'meta.json'), JSON.stringify(meta, null, 2));

    return profileDir;
  }

  private getLayoutDefinition(agent: string): AgentLayoutDefinition | null {
    return AGENT_LAYOUTS[agent as keyof typeof AGENT_LAYOUTS] ?? null;
  }

  private async ensureReservedProfile(
    agent: string,
    slug: string,
    description: string
  ): Promise<string> {
    const profileDir = path.join(this.contentDir, agent, slug);
    await fs.mkdir(profileDir, { recursive: true });

    const metaPath = path.join(profileDir, 'meta.json');
    if (!(await pathExists(metaPath))) {
      const meta: Meta = {
        name: slug,
        slug,
        agent,
        description,
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    }

    return profileDir;
  }

  async ensureBaseProfile(agent: string): Promise<string> {
    if (!this.tools[agent]) {
      throw new Error(`Unsupported agent: ${agent}`);
    }
    return this.ensureReservedProfile(agent, BASE_PROFILE_SLUG, 'Base profile (created by setup)');
  }

  private async ensureSharedEntryInitialized(
    entryPath: string,
    kind: SharedEntryKind
  ): Promise<void> {
    if (await pathExists(entryPath)) {
      return;
    }

    await fs.mkdir(path.dirname(entryPath), { recursive: true });
    if (kind === 'dir') {
      await fs.mkdir(entryPath, { recursive: true });
      return;
    }

    await fs.writeFile(entryPath, '', { flag: 'a' });
  }

  private async ensureSymlinkTarget(linkPath: string, targetPath: string): Promise<void> {
    try {
      const stat = await fs.lstat(linkPath);
      if (stat.isSymbolicLink()) {
        const currentTarget = await fs.readlink(linkPath);
        const currentAbsoluteTarget = path.isAbsolute(currentTarget)
          ? currentTarget
          : path.resolve(path.dirname(linkPath), currentTarget);

        if (path.resolve(currentAbsoluteTarget) === path.resolve(targetPath)) {
          return;
        }

        await fs.unlink(linkPath);
      } else {
        await fs.rm(linkPath, { recursive: true, force: true });
      }
    } catch {
      // Path missing, continue.
    }

    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    const relativeTarget = path.relative(path.dirname(linkPath), targetPath);
    await fs.symlink(relativeTarget, linkPath);
  }

  async ensureProfileLayout(agent: string, profileSlug: string): Promise<void> {
    if (profileSlug === SHARED_PROFILE_SLUG) {
      return;
    }

    const layout = this.getLayoutDefinition(agent);
    if (!layout) {
      return;
    }

    const profileDir = path.join(this.contentDir, agent, profileSlug);
    if (!(await pathExists(profileDir))) {
      return;
    }

    const sharedRoot = path.join(this.contentDir, agent, SHARED_PROFILE_SLUG);
    await fs.mkdir(sharedRoot, { recursive: true });

    const migrationRoot = path.join(
      sharedRoot,
      `_migrated-originals-${new Date().toISOString().replace(/[:.]/g, '-')}`
    );
    let migrationCreated = false;

    for (const entry of layout.sharedEntries) {
      const profilePath = path.join(profileDir, entry.path);
      const sharedPath = path.join(sharedRoot, entry.path);

      await fs.mkdir(path.dirname(sharedPath), { recursive: true });

      let profileStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        profileStat = await fs.lstat(profilePath);
      } catch {
        profileStat = null;
      }

      const sharedExists = await pathExists(sharedPath);

      if (!sharedExists) {
        if (profileStat && !profileStat.isSymbolicLink()) {
          await movePath(profilePath, sharedPath);
          profileStat = null;
        } else {
          await this.ensureSharedEntryInitialized(sharedPath, entry.kind);
        }
      } else if (profileStat && !profileStat.isSymbolicLink()) {
        if (!migrationCreated) {
          await fs.mkdir(migrationRoot, { recursive: true });
          migrationCreated = true;
        }
        const migrationPath = path.join(migrationRoot, profileSlug, entry.path);
        await fs.mkdir(path.dirname(migrationPath), { recursive: true });
        await movePath(profilePath, migrationPath);
        profileStat = null;
      }

      await this.ensureSharedEntryInitialized(sharedPath, entry.kind);
      await this.ensureSymlinkTarget(profilePath, sharedPath);
    }
  }

  async ensureBaseProfileLayout(agent: string): Promise<void> {
    await this.ensureBaseProfile(agent);
    await this.ensureProfileLayout(agent, BASE_PROFILE_SLUG);
  }

  private async collectManagedSymlinks(profileDir: string): Promise<ManagedSymlinkSnapshot[]> {
    const snapshots: ManagedSymlinkSnapshot[] = [];
    const root = path.resolve(profileDir);
    const contentRoot = path.resolve(this.contentDir);

    const walk = async (currentDir: string): Promise<void> => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        const relativePath = path.relative(root, absolutePath);

        if (entry.isSymbolicLink()) {
          const linkTarget = await fs.readlink(absolutePath);
          const resolvedTarget = path.isAbsolute(linkTarget)
            ? linkTarget
            : path.resolve(path.dirname(absolutePath), linkTarget);

          if (isSubpath(contentRoot, path.resolve(resolvedTarget))) {
            snapshots.push({
              relativePath,
              sourceResolvedTarget: path.resolve(resolvedTarget),
            });
          }
          continue;
        }

        if (entry.isDirectory()) {
          await walk(absolutePath);
        }
      }
    };

    await walk(profileDir);
    return snapshots;
  }

  async findBrokenSymlinks(rootPath: string): Promise<BrokenSymlink[]> {
    const broken: BrokenSymlink[] = [];

    const walk = async (currentPath: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);

        if (entry.isSymbolicLink()) {
          const target = await readSymlinkTarget(absolutePath);
          if (!target) {
            broken.push({ linkPath: absolutePath, target: '(unreadable target)' });
            continue;
          }

          try {
            // Access through the symlink path to detect broken links.
            await fs.access(absolutePath);
          } catch {
            broken.push({ linkPath: absolutePath, target });
          }
          continue;
        }

        if (entry.isDirectory()) {
          await walk(absolutePath);
        }
      }
    };

    await walk(rootPath);
    return broken;
  }

  private async materializeManagedSymlinks(
    destinationRoot: string,
    snapshots: ManagedSymlinkSnapshot[]
  ): Promise<void> {
    for (const snapshot of snapshots) {
      const destinationPath = path.join(destinationRoot, snapshot.relativePath);

      let destinationStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        destinationStat = await fs.lstat(destinationPath);
      } catch {
        destinationStat = null;
      }

      if (!destinationStat?.isSymbolicLink()) {
        continue;
      }

      await fs.unlink(destinationPath);
      await copyPathDereferenced(snapshot.sourceResolvedTarget, destinationPath);
    }
  }

  // ============================================================================
  // Symlink-based profile management
  // ============================================================================

  /**
   * Get the absolute path to an agent's global config directory.
   * Resolves relative paths from os.homedir().
   */
  getGlobalConfigPath(agent: string): string {
    const tool = this.tools[agent];
    if (!tool) {
      throw new Error(`Unsupported agent: ${agent}`);
    }
    return path.join(os.homedir(), tool.globalConfigDir);
  }

  /**
   * Check the state of an agent's global config directory.
   * Returns one of: 'active', 'unmanaged', 'missing', 'broken', 'external'
   */
  async getSymlinkStatus(agent: string): Promise<SymlinkStatus> {
    const globalPath = this.getGlobalConfigPath(agent);

    // Use lstat to check the path itself (doesn't follow symlinks)
    let stat;
    try {
      stat = await fs.lstat(globalPath);
    } catch {
      return 'missing';
    }

    // Not a symlink = real directory
    if (!stat.isSymbolicLink()) {
      return 'unmanaged';
    }

    // It's a symlink — check if target exists
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
      return 'broken';
    }

    // Check if target actually exists (follow the symlink)
    try {
      await fs.access(globalPath);
    } catch {
      return 'broken';
    }

    // Resolve target to absolute path
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(globalPath), target);

    // Check if target is in our content dir
    const contentDirAbs = path.resolve(this.contentDir);
    if (!absoluteTarget.startsWith(contentDirAbs + path.sep)) {
      return 'external';
    }

    return 'active';
  }

  /**
   * Get the active profile slug for an agent.
   * Returns null if the agent is not managed by us.
   */
  async getActiveProfile(agent: string): Promise<string | null> {
    const status = await this.getSymlinkStatus(agent);
    if (status !== 'active') {
      return null;
    }

    const globalPath = this.getGlobalConfigPath(agent);
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
      return null;
    }

    // Extract profile slug from target path
    // Target is like: /path/to/contentDir/agent/slug
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(globalPath), target);

    const slug = path.basename(absoluteTarget);
    return slug;
  }

  /**
   * Adopt an existing real directory as a managed profile.
   * Moves the directory to contentDir/<agent>/_base and creates a symlink back.
   * Throws if _base already exists.
   * If symlink creation fails after move, rolls back by moving the directory back.
   */
  async adoptExisting(
    agent: string,
    profileName: string = BASE_PROFILE_SLUG,
    options: { replaceExisting?: boolean } = {}
  ): Promise<void> {
    const globalPath = this.getGlobalConfigPath(agent);
    const status = await this.getSymlinkStatus(agent);

    if (status !== 'unmanaged') {
      throw new Error(
        `Cannot adopt: agent '${agent}' status is '${status}' (expected 'unmanaged')`
      );
    }

    const profileDir = path.join(this.contentDir, agent, profileName);

    // Check if profile already exists
    try {
      await fs.access(profileDir);
      if (options.replaceExisting) {
        await fs.rm(profileDir, { recursive: true, force: true });
      } else {
        throw new Error(
          `Cannot adopt: profile '${profileName}' already exists for agent '${agent}'`
        );
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good, profile doesn't exist
      } else {
        throw err;
      }
    }

    // Move the real directory to profile location
    await moveDirectory(globalPath, profileDir);

    // Create meta.json for the adopted profile
    const meta: Meta = {
      name: profileName,
      slug: profileName,
      agent,
      description: 'Base profile (adopted from original config)',
      created_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(profileDir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Create symlink back to the profile with rollback on failure
    try {
      await this.ensureProfileLayout(agent, profileName);
      await atomicSymlink(profileDir, globalPath);
    } catch (err) {
      // Rollback: move the directory back to its original location
      try {
        await moveDirectory(profileDir, globalPath);
      } catch (rollbackErr) {
        // If rollback fails, throw both errors
        throw new Error(
          `Failed to create symlink and rollback failed: ${err instanceof Error ? err.message : String(err)}. ` +
            `Rollback error: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`
        );
      }
      throw err;
    }
  }

  /**
   * Verify that an adoption was successful.
   * Checks that the symlink exists and points to the expected profile directory.
   * Returns true if verification passes, false otherwise.
   */
  async verifyAdoption(agent: string, profileName: string = BASE_PROFILE_SLUG): Promise<boolean> {
    const globalPath = this.getGlobalConfigPath(agent);
    const expectedProfileDir = path.join(this.contentDir, agent, profileName);

    // Check if global path is a symlink
    const status = await this.getSymlinkStatus(agent);
    if (status !== 'active') {
      return false;
    }

    // Check if symlink points to the expected profile directory
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
      return false;
    }

    // Resolve target to absolute path for comparison
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(globalPath), target);

    const absoluteExpected = path.resolve(expectedProfileDir);

    return absoluteTarget === absoluteExpected;
  }

  /**
   * Atomically switch the symlink to point to a different profile.
   * Uses atomic pattern: create temp symlink, then rename over target.
   */
  async switchProfile(agent: string, profileSlug: string): Promise<void> {
    if (profileSlug === SHARED_PROFILE_SLUG) {
      throw new Error(`Profile '${SHARED_PROFILE_SLUG}' is reserved and cannot be activated.`);
    }

    const globalPath = this.getGlobalConfigPath(agent);
    const profileDir = path.join(this.contentDir, agent, profileSlug);

    // Verify profile exists
    try {
      await fs.access(profileDir);
    } catch {
      throw new Error(`Profile '${profileSlug}' does not exist for agent '${agent}'`);
    }

    // Verify global path is a symlink
    const isLink = await isSymlink(globalPath);
    if (!isLink) {
      throw new Error(`Agent '${agent}' global config is not a symlink (status: unmanaged)`);
    }

    // Atomically swap the symlink
    await atomicSymlink(profileDir, globalPath);
  }

  /**
   * Unlink a managed profile - move contents back to global config dir.
   * This "releases" the agent from management.
   */
  async unlinkProfile(agent: string): Promise<void> {
    const globalPath = this.getGlobalConfigPath(agent);
    const status = await this.getSymlinkStatus(agent);

    if (status !== 'active') {
      throw new Error(`Cannot unlink: agent '${agent}' status is '${status}' (expected 'active')`);
    }

    const activeProfile = await this.getActiveProfile(agent);
    if (!activeProfile) {
      throw new Error(`Cannot determine active profile for agent '${agent}'`);
    }

    const profileDir = path.join(this.contentDir, agent, activeProfile);
    const globalParent = path.dirname(globalPath);
    const globalBaseName = path.basename(globalPath);
    const tempGlobalPath = path.join(globalParent, `.${globalBaseName}-release-${Date.now()}`);

    const managedSymlinks = await this.collectManagedSymlinks(profileDir);
    await copyDirectory(profileDir, tempGlobalPath);
    await this.materializeManagedSymlinks(tempGlobalPath, managedSymlinks);

    // Remove the managed symlink so the global path can become a real directory.
    await fs.unlink(globalPath);

    try {
      await fs.rename(tempGlobalPath, globalPath);
    } catch (error) {
      await fs.rm(tempGlobalPath, { recursive: true, force: true });
      try {
        await atomicSymlink(profileDir, globalPath);
      } catch (restoreError) {
        throw new Error(
          `Failed to restore original symlink after release error: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        );
      }
      throw error;
    }

    // Remove profile from managed content after successful release.
    await fs.rm(profileDir, { recursive: true, force: true });
  }

  // ============================================================================
  // Shared directory management
  // ============================================================================

  /**
   * Get the absolute path to a shared directory.
   */
  getSharedDirGlobalPath(name: string): string {
    const sharedDir = SHARED_DIRECTORIES[name];
    if (!sharedDir) {
      throw new Error(`Unknown shared directory: ${name}`);
    }
    return path.join(os.homedir(), sharedDir.globalPath);
  }

  /**
   * Get the content dir path for a shared directory.
   */
  getSharedDirContentPath(name: string): string {
    const sharedDir = SHARED_DIRECTORIES[name];
    if (!sharedDir) {
      throw new Error(`Unknown shared directory: ${name}`);
    }
    return path.join(this.contentDir, sharedDir.contentDirName);
  }

  /**
   * Check the state of a shared directory (same as getSymlinkStatus).
   */
  async getSharedDirStatus(name: string): Promise<SymlinkStatus> {
    const globalPath = this.getSharedDirGlobalPath(name);

    // Use lstat to check the path itself (doesn't follow symlinks)
    let stat;
    try {
      stat = await fs.lstat(globalPath);
    } catch {
      return 'missing';
    }

    // Not a symlink = real directory
    if (!stat.isSymbolicLink()) {
      return 'unmanaged';
    }

    // It's a symlink — check if target exists
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
      return 'broken';
    }

    // Check if target actually exists (follow the symlink)
    try {
      await fs.access(globalPath);
    } catch {
      return 'broken';
    }

    // Resolve target to absolute path
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(globalPath), target);

    // Check if target is in our content dir
    const contentDirAbs = path.resolve(this.contentDir);
    if (!absoluteTarget.startsWith(contentDirAbs + path.sep)) {
      return 'external';
    }

    return 'active';
  }

  /**
   * Adopt an existing shared directory.
   * Moves it to contentDir/<contentDirName> and creates a symlink back.
   */
  async adoptSharedDir(name: string): Promise<void> {
    const globalPath = this.getSharedDirGlobalPath(name);
    const contentPath = this.getSharedDirContentPath(name);
    const status = await this.getSharedDirStatus(name);

    if (status !== 'unmanaged') {
      throw new Error(
        `Cannot adopt shared dir '${name}': status is '${status}' (expected 'unmanaged')`
      );
    }

    // Check if content path already exists
    try {
      await fs.access(contentPath);
      throw new Error(`Cannot adopt: shared dir content already exists at ${contentPath}`);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good, doesn't exist
      } else {
        throw err;
      }
    }

    // Move the real directory to content location
    await moveDirectory(globalPath, contentPath);

    // Create symlink back
    await atomicSymlink(contentPath, globalPath);
  }

  /**
   * Unlink a managed shared directory.
   * Moves contents back to global location.
   */
  async unlinkSharedDir(name: string): Promise<void> {
    const globalPath = this.getSharedDirGlobalPath(name);
    const contentPath = this.getSharedDirContentPath(name);
    const status = await this.getSharedDirStatus(name);

    if (status !== 'active') {
      throw new Error(
        `Cannot unlink shared dir '${name}': status is '${status}' (expected 'active')`
      );
    }

    // Remove the symlink
    await fs.unlink(globalPath);

    // Move content back to global location
    await moveDirectory(contentPath, globalPath);
  }
}
