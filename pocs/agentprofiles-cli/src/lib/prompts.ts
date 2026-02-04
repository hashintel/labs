import { select, isCancel, cancel } from '@clack/prompts';
import { SUPPORTED_TOOLS } from '../types/index.js';
import { ConfigManager } from './config.js';

export async function promptForAgent(message = 'Select an agent:'): Promise<string> {
  const options = Object.entries(SUPPORTED_TOOLS).map(([key, tool]) => ({
    value: key,
    label: tool.description,
    hint: key,
  }));

  const response = await select({
    message,
    options,
  });

  if (isCancel(response)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  return response as string;
}

export async function promptForProfile(
  config: ConfigManager,
  agent: string,
  message = 'Select a profile:'
): Promise<string | null> {
  const profiles = await config.getProfiles(agent);

  if (profiles.length === 0) {
    return null;
  }

  const response = await select({
    message,
    options: profiles.map((p) => ({
      value: p.slug,
      label: p.name,
      hint: p.description,
    })),
  });

  if (isCancel(response)) {
    cancel('Operation cancelled.');
    process.exit(0);
  }

  return response as string;
}
