import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CliConfig, Meta, SUPPORTED_TOOLS, SHARED_DIRECTORIES } from '../types/index.js';
import { validateProfileName, slugify, validateSlug } from './validation.js';
import { getAgentGitignore } from './gitignore.js';
import {
  readSymlinkTarget,
  isSymlink,
  atomicSymlink,
  moveDirectory,
} from './symlink.js';

// Resolution order for contentDir:
// 1. AGENTPROFILES_CONTENT_DIR environment variable
// 2. config.json contentDir setting
// 3. Default: same as configDir

export type SymlinkStatus = 'active' | 'unmanaged' | 'missing' | 'broken' | 'external';

function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getDefaultConfigDir(): string {
  // AGENTPROFILES_CONFIG_DIR overrides everything
  if (process.env.AGENTPROFILES_CONFIG_DIR) {
    return process.env.AGENTPROFILES_CONFIG_DIR;
  }
  return path.join(getXdgConfigHome(), 'agentprofiles');
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

  getConfigDir(): string {
    return this.configDir;
  }

  getContentDir(): string {
    return this.contentDir;
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
    const validationError = validateProfileName(name);
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

    // Check if path exists
    try {
      await fs.access(globalPath);
    } catch {
      return 'missing';
    }

    // Check if it's a symlink
    const isLink = await isSymlink(globalPath);
    if (!isLink) {
      return 'unmanaged';
    }

    // It's a symlink - check if target exists
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
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
   */
  async adoptExisting(agent: string, profileName: string = '_base'): Promise<void> {
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
      throw new Error(
        `Cannot adopt: profile '${profileName}' already exists for agent '${agent}'`
      );
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good, profile doesn't exist
      } else {
        throw err;
      }
    }

    // Move the real directory to profile location
    await moveDirectory(globalPath, profileDir);

    // Create symlink back to the profile
    await atomicSymlink(profileDir, globalPath);
  }

  /**
   * Atomically switch the symlink to point to a different profile.
   * Uses atomic pattern: create temp symlink, then rename over target.
   */
  async switchProfile(agent: string, profileSlug: string): Promise<void> {
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
      throw new Error(
        `Cannot unlink: agent '${agent}' status is '${status}' (expected 'active')`
      );
    }

    const activeProfile = await this.getActiveProfile(agent);
    if (!activeProfile) {
      throw new Error(`Cannot determine active profile for agent '${agent}'`);
    }

    const profileDir = path.join(this.contentDir, agent, activeProfile);

    // Remove the symlink
    await fs.unlink(globalPath);

    // Move profile contents back to global location
    await moveDirectory(profileDir, globalPath);
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

    // Check if path exists
    try {
      await fs.access(globalPath);
    } catch {
      return 'missing';
    }

    // Check if it's a symlink
    const isLink = await isSymlink(globalPath);
    if (!isLink) {
      return 'unmanaged';
    }

    // It's a symlink - check if target exists
    const target = await readSymlinkTarget(globalPath);
    if (!target) {
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
