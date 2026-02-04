import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CliConfig, Meta, SUPPORTED_TOOLS } from '../types/index.js';
import { validateProfileName, slugify, validateSlug } from './validation.js';
import { getAgentGitignore } from './gitignore.js';

// Resolution order for contentDir:
// 1. AGENTPROFILES_CONTENT_DIR environment variable
// 2. config.json contentDir setting
// 3. Default: same as configDir

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
}
