export interface Meta {
  name: string;
  slug: string;
  agent: string;
  description?: string;
  created_at?: string;
}

export interface ToolDefinition {
  envVar: string;
  xdgCompliant: boolean;
  description: string;
}

export interface Config {
  tools: Record<string, ToolDefinition>;
}

export interface CliConfig {
  contentDir?: string; // Path to content directory (relative to configDir or absolute)
}

export const SUPPORTED_TOOLS: Record<string, ToolDefinition> = {
  claude: {
    envVar: 'CLAUDE_CONFIG_DIR',
    xdgCompliant: false,
    description: 'Claude Code',
  },
  opencode: {
    envVar: 'OPENCODE_CONFIG_DIR',
    xdgCompliant: true,
    description: 'OpenCode',
  },
};
