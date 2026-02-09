import { defineCommand } from 'citty';
import { outro, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { promptForAgent, promptForProfile } from '../lib/prompts.js';

export function parseEditorValue(editor: string): { command: string; args: string[] } {
  const trimmed = editor.trim();
  if (!trimmed) {
    return { command: '', args: [] };
  }

  const tokens = trimmed.match(/(".*?"|'.*?'|\S+)/g) ?? [];

  if (tokens.length === 0) {
    return { command: '', args: [] };
  }

  const stripQuotes = (value: string) => {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  };

  const [commandToken, ...argTokens] = tokens;

  if (!commandToken) {
    return { command: '', args: [] };
  }

  return {
    command: stripQuotes(commandToken),
    args: argTokens.map(stripQuotes),
  };
}

export async function editCommand(agent?: string, name?: string) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();

  let resolvedName: string;
  if (name) {
    resolvedName = name;
  } else {
    const selected = await promptForProfile(config, resolvedAgent, 'Select profile to edit:');
    if (!selected) {
      note(
        `No profiles found for ${resolvedAgent}. Create one first with: agentprofiles add ${resolvedAgent}`,
        'No Profiles'
      );
      process.exit(0);
    }
    resolvedName = selected;
  }

  const profileDir = path.join(config.getContentDir(), resolvedAgent, resolvedName);

  const editorEnv = process.env.EDITOR?.trim();
  if (editorEnv) {
    const { command, args } = parseEditorValue(editorEnv);
    if (command) {
      const child = spawn(command, [...args, profileDir], { stdio: 'inherit' });
      child.on('exit', () => {
        outro('Editor closed');
      });
      return;
    }
  }

  const platform = process.platform;
  const openCommand = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : null;

  if (!openCommand) {
    console.log(profileDir);
    return;
  }

  const child = spawn(openCommand, [profileDir], { stdio: 'inherit' });
  child.on('error', () => {
    console.log(profileDir);
  });
}

export default defineCommand({
  meta: {
    name: 'edit',
    description: 'Edit a profile configuration',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name',
      required: false,
    },
  },
  async run({ args }) {
    await editCommand(args.agent, args.name);
  },
});
