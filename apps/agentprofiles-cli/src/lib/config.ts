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
  getAgentStrategy as _getAgentStrategy,
  getDefaultProfileInclude,
  resolveProfileInclude,
  type ProfileInclude,
} from './profileinclude.js';
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

export interface BrokenSymlink {
  linkPath: string;
  target: string;
}

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

  async ensureBaseProfileLayout(agent: string): Promise<void> {
    await this.ensureBaseProfile(agent);
    if (this.getAgentStrategy(agent) === 'include') {
      await this.ensureIncludeAgentFiles(agent);
      await this.ensureIncludeProfileLayout(agent, BASE_PROFILE_SLUG);
    }
    // Directory-strategy agents don't need additional layout scaffolding
  }

  // ============================================================================
  // Include-strategy methods (inverted per-file symlinks for messy agents)
  // ============================================================================

  /**
   * Write .profileinclude and .gitignore to the agent content directory if missing.
   * Never overwrites user-edited copies.
   */
  private async ensureIncludeAgentFiles(agent: string): Promise<void> {
    const agentDir = path.join(this.contentDir, agent);
    await fs.mkdir(agentDir, { recursive: true });

    const includeContent = this.getDefaultProfileIncludeContent(agent);
    if (includeContent) {
      const includePath = path.join(agentDir, '.profileinclude');
      if (!(await pathExists(includePath))) {
        await fs.writeFile(includePath, includeContent);
      }
    }

    // .gitignore: reuse the existing per-agent helper (already idempotent)
    await this.ensureAgentGitignore(agentDir, agent);
  }

  /**
   * Ensure all allow-listed dir entries exist in a profile directory.
   * - Dir entries: create empty dir + .gitkeep if missing
   * - File entries: skip (user/agent creates them)
   * - Creates parent directories for nested entries
   */
  async ensureIncludeProfileLayout(agent: string, profileSlug: string): Promise<void> {
    const include = this.getProfileInclude(agent);
    if (!include) return;

    const profileDir = path.join(this.contentDir, agent, profileSlug);
    if (!(await pathExists(profileDir))) return;

    for (const dir of include.dirs) {
      const dirPath = path.join(profileDir, dir);
      await fs.mkdir(dirPath, { recursive: true });
      const gitkeepPath = path.join(dirPath, '.gitkeep');
      if (!(await pathExists(gitkeepPath))) {
        const entries = await fs.readdir(dirPath);
        if (entries.length === 0) {
          await fs.writeFile(gitkeepPath, '');
        }
      }
    }
    // File entries: no action — created by user or agent
  }

  /**
   * Adopt an existing real directory for an include-based agent.
   * Leaves the global dir in place. Moves allow-listed real entries to _base
   * and creates per-entry symlinks pointing from globalPath back to _base.
   */
  private async adoptExistingInclude(
    agent: string,
    profileName: string,
    options: { replaceExisting?: boolean } = {}
  ): Promise<void> {
    const globalPath = this.getGlobalConfigPath(agent);

    // Ensure global dir is a real directory
    let globalStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      globalStat = await fs.lstat(globalPath);
    } catch {
      // Doesn't exist — create it
      await fs.mkdir(globalPath, { recursive: true });
      globalStat = await fs.lstat(globalPath);
    }
    if (globalStat.isSymbolicLink()) {
      throw new Error(
        `Cannot adopt include-based agent '${agent}': global path is a symlink. Run 'release' first.`
      );
    }

    const profileDir = path.join(this.contentDir, agent, profileName);

    // Handle existing profile
    let profileDirExists = false;
    try {
      await fs.access(profileDir);
      profileDirExists = true;
      if (options.replaceExisting) {
        await fs.rm(profileDir, { recursive: true, force: true });
        profileDirExists = false;
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good — profile doesn't exist yet
      } else {
        throw err;
      }
    }

    if (!profileDirExists) {
      await fs.mkdir(profileDir, { recursive: true });
    }

    const include = this.getProfileInclude(agent);
    if (!include) {
      throw new Error(`Agent '${agent}' has no .profileinclude — cannot use include strategy`);
    }

    // Process allow-listed entries
    const backupBase = `${globalPath}.bak-${Date.now()}`;
    let backupCreated = false;

    for (const entry of [...include.files, ...include.dirs]) {
      const isDir = include.dirs.includes(entry);
      const globalEntryPath = path.join(globalPath, entry);
      const profileEntryPath = path.join(profileDir, entry);

      // Ensure parent dir exists in profile
      await fs.mkdir(path.dirname(profileEntryPath), { recursive: true });

      let entryStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        entryStat = await fs.lstat(globalEntryPath);
      } catch {
        // Entry doesn't exist in global dir
      }

      if (entryStat?.isSymbolicLink()) {
        // Existing symlink — skip, don't double-link
        continue;
      }

      if (entryStat) {
        // Real file or dir exists in global dir
        const profileEntryExists = await pathExists(profileEntryPath);
        if (profileDirExists && profileEntryExists) {
          // Profile already has this entry — back up the global copy instead of overwriting
          if (!backupCreated) {
            await fs.mkdir(backupBase, { recursive: true });
            backupCreated = true;
          }
          const backupEntryPath = path.join(backupBase, entry);
          await fs.mkdir(path.dirname(backupEntryPath), { recursive: true });
          await movePath(globalEntryPath, backupEntryPath);
        } else {
          // Profile doesn't have this entry — move global copy into profile
          await movePath(globalEntryPath, profileEntryPath);
        }
      } else if (!profileDirExists || !(await pathExists(profileEntryPath))) {
        if (isDir) {
          // Dir entry that doesn't exist yet in either place: scaffold with .gitkeep
          await fs.mkdir(profileEntryPath, { recursive: true });
          await fs.writeFile(path.join(profileEntryPath, '.gitkeep'), '');
        } else {
          // File entry missing from both global and profile: skip (no dangling symlink)
          continue;
        }
      }
      // If profileDirExists && profileEntryExists && !entryStat: profile already has it, nothing to move

      // Only create symlink if target now exists in the profile
      if (!(await pathExists(profileEntryPath))) continue;

      // Create symlink: globalPath/{entry} -> relative path to profile/{entry}
      await fs.mkdir(path.dirname(globalEntryPath), { recursive: true });
      const relTarget = path.relative(path.dirname(globalEntryPath), profileEntryPath);
      await fs.symlink(relTarget, globalEntryPath);
    }

    // Write meta.json if not already present
    const metaPath = path.join(profileDir, 'meta.json');
    if (!(await pathExists(metaPath))) {
      const meta: Meta = {
        name: profileName,
        slug: profileName,
        agent,
        description: 'Base profile (adopted from original config)',
        created_at: new Date().toISOString(),
      };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    }

    // Write .profileinclude and .gitignore to agent content dir if missing
    await this.ensureIncludeAgentFiles(agent);
  }

  /**
   * Get the active profile slug for an include-based agent.
   * Reads the target of the first managed per-entry symlink inside globalPath.
   * Returns null if not managed or no symlinks found.
   */
  async getActiveProfileInclude(agent: string): Promise<string | null> {
    const include = this.getProfileInclude(agent);
    if (!include) return null;

    const globalPath = this.getGlobalConfigPath(agent);
    const contentDirAbs = path.resolve(this.contentDir);
    const allEntries = [...include.files, ...include.dirs];

    for (const entry of allEntries) {
      const entryPath = path.join(globalPath, entry);
      let entryStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        entryStat = await fs.lstat(entryPath);
      } catch {
        continue;
      }
      if (!entryStat?.isSymbolicLink()) continue;

      const target = await fs.readlink(entryPath);
      const absTarget = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(entryPath), target);

      if (!isSubpath(contentDirAbs, absTarget)) continue;

      // Target is contentDir/{agent}/{slug}/{entry...}
      // Walk up entry depth to find the slug directory
      const entryDepth = entry.split(path.sep).length;
      let slugPath = absTarget;
      for (let i = 0; i < entryDepth; i++) {
        slugPath = path.dirname(slugPath);
      }
      return path.basename(slugPath);
    }

    return null;
  }

  /**
   * Get the symlink status for an include-based agent.
   * The global dir is a real directory; management is detected via _base + per-entry symlinks.
   */
  async getIncludeSymlinkStatus(agent: string): Promise<SymlinkStatus> {
    const globalPath = this.getGlobalConfigPath(agent);

    let globalStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      globalStat = await fs.lstat(globalPath);
    } catch {
      return 'missing';
    }

    // If it's a symlink (leftover from old directory-strategy setup)
    if (globalStat.isSymbolicLink()) {
      const target = await readSymlinkTarget(globalPath);
      if (!target) return 'broken';
      try {
        await fs.access(globalPath);
      } catch {
        return 'broken';
      }
      const absTarget = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(globalPath), target);
      const contentDirAbs = path.resolve(this.contentDir);
      return absTarget.startsWith(contentDirAbs + path.sep) ? 'active' : 'external';
    }

    // Real directory — check if _base exists (indicates management)
    const basePath = path.join(this.contentDir, agent, BASE_PROFILE_SLUG);
    if (!(await pathExists(basePath))) {
      return 'unmanaged';
    }

    // Require at least one per-entry symlink pointing into contentDir
    const include = this.getProfileInclude(agent);
    const contentDirAbs = path.resolve(this.contentDir);
    let managedSymlinkCount = 0;

    if (include) {
      for (const entry of [...include.files, ...include.dirs]) {
        const entryPath = path.join(globalPath, entry);
        let entryStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
        try {
          entryStat = await fs.lstat(entryPath);
        } catch {
          continue; // Missing entry
        }
        if (!entryStat.isSymbolicLink()) continue;

        // Check if this symlink points into our contentDir
        const target = await fs.readlink(entryPath);
        const absTarget = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(entryPath), target);
        if (!absTarget.startsWith(contentDirAbs + path.sep)) continue;

        // It's a managed symlink — check if it's broken
        try {
          await fs.access(entryPath); // follows symlink
        } catch {
          return 'broken';
        }
        managedSymlinkCount++;
      }
    }

    if (managedSymlinkCount === 0) {
      return 'unmanaged';
    }

    return 'active';
  }

  /**
   * Switch the active profile for an include-based agent.
   * Repoints managed per-entry symlinks inside globalPath to the target profile.
   * Leaves real files/dirs and non-managed symlinks untouched.
   */
  async switchProfileInclude(agent: string, profileSlug: string): Promise<void> {
    const include = this.getProfileInclude(agent);
    if (!include) {
      throw new Error(`Agent '${agent}' has no .profileinclude`);
    }

    const globalPath = this.getGlobalConfigPath(agent);
    const profileDir = path.join(this.contentDir, agent, profileSlug);

    if (!(await pathExists(profileDir))) {
      throw new Error(`Profile '${profileSlug}' does not exist for agent '${agent}'`);
    }

    // Scaffold any missing entries in the target profile
    await this.ensureIncludeProfileLayout(agent, profileSlug);

    const contentDirAbs = path.resolve(this.contentDir);

    for (const entry of [...include.files, ...include.dirs]) {
      const globalEntryPath = path.join(globalPath, entry);
      const profileEntryPath = path.join(profileDir, entry);

      // Only create symlink if target exists in the profile
      if (!(await pathExists(profileEntryPath))) continue;

      let existingStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        existingStat = await fs.lstat(globalEntryPath);
      } catch {
        // Entry missing — will create symlink below
      }

      if (existingStat) {
        if (existingStat.isSymbolicLink()) {
          const target = await fs.readlink(globalEntryPath);
          const absTarget = path.isAbsolute(target)
            ? target
            : path.resolve(path.dirname(globalEntryPath), target);
          if (!isSubpath(contentDirAbs, absTarget)) {
            continue; // External symlink — leave it
          }
          await fs.unlink(globalEntryPath); // Remove old managed symlink
        } else {
          continue; // Real file/dir — don't clobber
        }
      }

      // Create symlink: globalPath/{entry} -> relative path to profile/{entry}
      await fs.mkdir(path.dirname(globalEntryPath), { recursive: true });
      const relTarget = path.relative(path.dirname(globalEntryPath), profileEntryPath);
      await fs.symlink(relTarget, globalEntryPath);
    }
  }

  /**
   * Release an include-based agent from management.
   * For each managed per-entry symlink inside globalPath: removes the symlink
   * and copies the real content from the active profile back into globalPath.
   * Does NOT delete the profile directory.
   */
  async unlinkProfileInclude(agent: string): Promise<void> {
    const include = this.getProfileInclude(agent);
    if (!include) {
      throw new Error(`Agent '${agent}' has no .profileinclude`);
    }

    const globalPath = this.getGlobalConfigPath(agent);
    const contentDirAbs = path.resolve(this.contentDir);

    // Determine the active profile before removing any symlinks
    const activeProfile = await this.getActiveProfileInclude(agent);

    for (const entry of [...include.files, ...include.dirs]) {
      const globalEntryPath = path.join(globalPath, entry);

      let entryStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        entryStat = await fs.lstat(globalEntryPath);
      } catch {
        continue;
      }

      if (!entryStat.isSymbolicLink()) continue; // Real file — leave it

      const target = await fs.readlink(globalEntryPath);
      const absTarget = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(globalEntryPath), target);

      if (!isSubpath(contentDirAbs, absTarget)) continue; // External symlink — leave it

      // Remove the managed symlink
      await fs.unlink(globalEntryPath);

      // Copy content from profile back into globalPath
      if (await pathExists(absTarget)) {
        await fs.mkdir(path.dirname(globalEntryPath), { recursive: true });
        const targetStat = await fs.lstat(absTarget);
        if (targetStat.isDirectory()) {
          await copyDirectory(absTarget, globalEntryPath);
        } else {
          await fs.copyFile(absTarget, globalEntryPath);
        }
      }
    }

    // Remove the active profile directory so status returns to 'unmanaged'.
    // This mirrors the directory-strategy unlinkProfile behavior and is safe
    // here because unlinkProfile is only called from the release command.
    if (activeProfile) {
      const profileDir = path.join(this.contentDir, agent, activeProfile);
      await fs.rm(profileDir, { recursive: true, force: true });
    }
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

  // ============================================================================
  // Symlink-based profile management
  // ============================================================================

  /**
   * Get the symlink strategy for an agent.
   * - 'include': inverted per-file symlinks (messy agents: claude, codex)
   * - 'directory': whole-directory symlink (clean agents: amp, opencode, etc.)
   *
   * TODO: check contentDir/{agent}/.profileinclude first (content-dir override).
   */
  getAgentStrategy(agent: string): 'include' | 'directory' {
    return _getAgentStrategy(agent);
  }

  /**
   * Resolve the ProfileInclude for an include-based agent.
   * Returns null for directory-based agents.
   *
   * TODO: read from contentDir/{agent}/.profileinclude when content-dir override
   * is implemented.
   */
  getProfileInclude(agent: string): ProfileInclude | null {
    return resolveProfileInclude(agent);
  }

  /**
   * Get the default .profileinclude content string for an agent (for writing to disk).
   * Returns null for directory-based agents.
   */
  getDefaultProfileIncludeContent(agent: string): string | null {
    return getDefaultProfileInclude(agent);
  }

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
    if (this.getAgentStrategy(agent) === 'include') {
      return this.getIncludeSymlinkStatus(agent);
    }

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
    if (this.getAgentStrategy(agent) === 'include') {
      return this.getActiveProfileInclude(agent);
    }

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
    if (this.getAgentStrategy(agent) === 'include') {
      return this.adoptExistingInclude(agent, profileName, options);
    }

    const globalPath = this.getGlobalConfigPath(agent);
    const status = await this.getSymlinkStatus(agent);

    if (status !== 'unmanaged') {
      throw new Error(
        `Cannot adopt: agent '${agent}' status is '${status}' (expected 'unmanaged')`
      );
    }

    const profileDir = path.join(this.contentDir, agent, profileName);

    // Check if profile already exists
    let profileDirExists = false;
    try {
      await fs.access(profileDir);
      profileDirExists = true;
      if (options.replaceExisting) {
        await fs.rm(profileDir, { recursive: true, force: true });
        profileDirExists = false;
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good, profile doesn't exist
      } else {
        throw err;
      }
    }

    if (!profileDirExists) {
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
    } else {
      // Profile already exists (e.g. content repo cloned) — back up globalPath and symlink to existing profile
      const backupPath = `${globalPath}.bak-${Date.now()}`;
      await moveDirectory(globalPath, backupPath);
      await atomicSymlink(profileDir, globalPath);
    }
  }

  /**
   * Verify that an adoption was successful.
   * Checks that the symlink exists and points to the expected profile directory.
   * Returns true if verification passes, false otherwise.
   */
  async verifyAdoption(agent: string, profileName: string = BASE_PROFILE_SLUG): Promise<boolean> {
    const expectedProfileDir = path.join(this.contentDir, agent, profileName);

    if (this.getAgentStrategy(agent) === 'include') {
      // For include-based agents: verify that _base exists and at least one
      // managed per-entry symlink points to the expected profile directory.
      if (!(await pathExists(expectedProfileDir))) return false;

      const include = this.getProfileInclude(agent);
      if (!include) return false;

      const globalPath = this.getGlobalConfigPath(agent);
      const contentDirAbs = path.resolve(this.contentDir);
      const allEntries = [...include.files, ...include.dirs];

      // If include list is empty, treat as verified if profile dir exists
      if (allEntries.length === 0) return true;

      for (const entry of allEntries) {
        const entryPath = path.join(globalPath, entry);
        let entryStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
        try {
          entryStat = await fs.lstat(entryPath);
        } catch {
          continue;
        }
        if (!entryStat?.isSymbolicLink()) continue;

        const target = await fs.readlink(entryPath);
        const absTarget = path.isAbsolute(target)
          ? target
          : path.resolve(path.dirname(entryPath), target);

        if (!isSubpath(contentDirAbs, absTarget)) continue;

        // Check target points to the expected profile
        const expectedEntryPath = path.resolve(expectedProfileDir, entry);
        if (path.resolve(absTarget) === expectedEntryPath) return true;
      }

      return false;
    }

    const globalPath = this.getGlobalConfigPath(agent);

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

    if (this.getAgentStrategy(agent) === 'include') {
      return this.switchProfileInclude(agent, profileSlug);
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
    if (this.getAgentStrategy(agent) === 'include') {
      return this.unlinkProfileInclude(agent);
    }

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

    // Copy the profile directory to a temp location (preserving symlinks as copies)
    await copyDirectory(profileDir, tempGlobalPath);

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
    let contentPathExists = false;
    try {
      await fs.access(contentPath);
      contentPathExists = true;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        // Good, doesn't exist
      } else {
        throw err;
      }
    }

    if (!contentPathExists) {
      // Move the real directory to content location
      await moveDirectory(globalPath, contentPath);
    } else {
      // Content already exists (e.g. content repo cloned) — back up globalPath and symlink to existing content
      const backupPath = `${globalPath}.bak-${Date.now()}`;
      await moveDirectory(globalPath, backupPath);
    }

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
