export interface Meta {
  name: string;
  slug: string;
  agent: string;
  description?: string;
  created_at?: string;
}

export interface CacheDir {
  /** Path relative to os.homedir() */
  path: string;
  /** Human-readable description */
  label: string;
}

export interface CacheDirs {
  /** Always deletable, auto-regenerated */
  safe: CacheDir[];
  /** Prompt before deleting (loses prefs, history, etc.) */
  optional: CacheDir[];
}

export interface ToolDefinition {
  /** Path to the agent's global config dir, relative to os.homedir() */
  globalConfigDir: string;
  description: string;
  /** Optional: env var that can also redirect this agent (for reference/compat) */
  envVar?: string;
  /** Optional: cache/state dirs separate from config that may need clearing on profile switch */
  cacheDirs?: CacheDirs;
}

export interface Config {
  tools: Record<string, ToolDefinition>;
}

export interface CliConfig {
  contentDir?: string; // Path to content directory (relative to configDir or absolute)
}

export interface SharedDirectory {
  /** Name of the shared directory (e.g., 'agents') */
  name: string;
  /** Path relative to os.homedir() (e.g., '.agents') */
  globalPath: string;
  /** Name in content dir with underscore prefix (e.g., '_agents') */
  contentDirName: string;
  description: string;
}

export const SHARED_DIRECTORIES: Record<string, SharedDirectory> = {
  agents: {
    name: 'agents',
    globalPath: '.agents',
    contentDirName: '_agents',
    description: 'Cross-agent shared resources (skills, etc.)',
  },
};

export const BASE_PROFILE_SLUG = '_base';
export const SHARED_PROFILE_SLUG = '_shared';
export const RESERVED_PROFILE_SLUGS = [BASE_PROFILE_SLUG, SHARED_PROFILE_SLUG] as const;

export const SUPPORTED_TOOLS: Record<string, ToolDefinition> = {
  claude: {
    globalConfigDir: '.claude',
    description: 'Claude Code',
    envVar: 'CLAUDE_CONFIG_DIR',
  },
  amp: {
    globalConfigDir: '.config/amp',
    description: 'Amp',
    envVar: 'AMP_CONFIG_DIR',
    cacheDirs: {
      safe: [{ path: '.cache/amp', label: 'Logs and traces' }],
      optional: [],
    },
  },
  opencode: {
    globalConfigDir: '.config/opencode',
    description: 'OpenCode',
    envVar: 'OPENCODE_CONFIG_DIR',
    cacheDirs: {
      safe: [{ path: '.cache/opencode', label: 'Cache (auto-regenerated)' }],
      optional: [{ path: '.local/state/opencode', label: 'State (prefs, prompt history)' }],
    },
  },
  codex: {
    globalConfigDir: '.codex',
    description: 'Codex',
    envVar: 'CODEX_CONFIG_DIR',
  },
  gemini: {
    globalConfigDir: '.gemini',
    description: 'Gemini',
    envVar: 'GEMINI_CONFIG_DIR',
  },
  augment: {
    globalConfigDir: '.augment',
    description: 'Augment',
    envVar: 'AUGMENT_CONFIG_DIR',
  },
};
