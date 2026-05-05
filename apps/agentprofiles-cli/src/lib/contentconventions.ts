import type { SharedDirectory, ToolDefinition } from '../types/index.js';

export const SHARED_AGENT_INSTRUCTIONS_FILE = 'AGENTS.md';

const PROFILE_INSTRUCTION_FILES: Record<string, string> = {
  amp: 'AGENTS.md',
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
  opencode: 'AGENTS.md',
};

export function getProfileInstructionFile(agent: string): string | null {
  return PROFILE_INSTRUCTION_FILES[agent] ?? null;
}

function renderStructureTree(
  contentDirName: string,
  tools: Record<string, ToolDefinition>,
  sharedDirectories: Record<string, SharedDirectory>
): string {
  const entries = [
    ...Object.values(sharedDirectories).map((sharedDir) => ({
      name: `${sharedDir.contentDirName}/`,
      description: `${sharedDir.description} (shared content)`,
    })),
    ...Object.entries(tools).map(([agent, tool]) => ({
      name: `${agent}/`,
      description: `${tool.description} profiles`,
    })),
  ];

  return [
    `${contentDirName}/`,
    ...entries.map((entry, index) => {
      const branch = index === entries.length - 1 ? '└──' : '├──';
      return `${branch} ${entry.name.padEnd(20)} # ${entry.description}`;
    }),
  ].join('\n');
}

export function renderContentDirAgentsMd(
  contentDirName: string,
  tools: Record<string, ToolDefinition>,
  sharedDirectories: Record<string, SharedDirectory>
): string {
  const includeAgents = ['claude', 'codex'].filter((agent) => agent in tools);
  const directoryAgents = Object.keys(tools).filter((agent) => !includeAgents.includes(agent));

  const lines = [
    `# ${contentDirName}/`,
    '',
    'This directory is the content directory for `agentprofiles-cli`.',
    '',
    'It is registered via `config.json` using the `contentDir` setting.',
    '',
    '## Structure',
    '',
    '```',
    renderStructureTree(contentDirName, tools, sharedDirectories),
    '```',
    '',
    '## How Profiles Work',
    '',
    '- `agentprofiles setup` creates per-agent directories and ensures `_base` scaffolding.',
    '- `agentprofiles add <agent> <profile>` creates named profiles under the matching agent directory.',
    '- `agentprofiles set <agent> <profile>` activates a profile for that agent.',
  ];

  if (directoryAgents.length > 0) {
    lines.push(
      `- Directory-strategy agents (${directoryAgents.join(', ')}) activate by swapping the whole global config directory symlink.`
    );
  }

  if (includeAgents.length > 0) {
    lines.push(
      `- Include-strategy agents (${includeAgents.join(', ')}) keep the global config directory real and symlink only allow-listed entries from \`.profileinclude\`.`
    );
  }

  lines.push(
    '- `_agents/AGENTS.md` is the shared instructions source of truth when present.',
    '',
    '## Rules For Editing',
    '',
    '- Do not rename or move profile directories; activation symlinks depend on these paths.',
    '- Do not delete `meta.json`; the CLI uses it to enumerate profiles.',
    '- Agent config files can be edited freely unless they are intentionally symlinked to shared defaults.',
    '- Agent-level `.gitignore` files are managed by the CLI.',
    ''
  );

  return lines.join('\n');
}
