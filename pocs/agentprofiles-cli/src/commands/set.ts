import { defineCommand } from 'citty';
import { outro, select, text, isCancel, cancel, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureBootstrapBlock,
  updateAgentBlock,
  MANAGED_ENVRC_FILENAME,
  LEGACY_MANAGED_ENVRC_FILENAME,
} from '../lib/envrc.js';
import { validateProfileName, slugify } from '../lib/validation.js';
import { spawn } from 'node:child_process';
import { getDirenvHookHint, isDirenvHookLoaded } from '../lib/direnv.js';
import { generateName } from '@criblinc/docker-names';
import { promptForAgent } from '../lib/prompts.js';

type SetOptions = {
  allow?: boolean;
};

function toShellPath(absolutePath: string): string {
  const home = os.homedir();
  if (absolutePath.startsWith(home)) {
    return absolutePath.replace(home, '$HOME');
  }
  return absolutePath;
}

function runDirenvAllow() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('direnv', ['allow'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`direnv allow failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function resolveManagedEnvrcPath(cwd: string) {
  const nextPath = path.join(cwd, MANAGED_ENVRC_FILENAME);
  const legacyPath = path.join(cwd, LEGACY_MANAGED_ENVRC_FILENAME);

  try {
    await fs.access(nextPath);
    return nextPath;
  } catch {
    // Continue
  }

  try {
    await fs.access(legacyPath);
    try {
      await fs.rename(legacyPath, nextPath);
    } catch {
      try {
        const legacyContent = await fs.readFile(legacyPath, 'utf-8');
        await fs.writeFile(nextPath, legacyContent);
        await fs.unlink(legacyPath);
      } catch {
        // If migration fails, we'll fall back to an empty file.
      }
    }
  } catch {
    // No legacy file
  }

  return nextPath;
}

export async function setCommand(agent?: string, name?: string | SetOptions, options?: SetOptions) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to set profile for:'));
  let resolvedName: string | undefined = typeof name === 'string' ? name : undefined;
  const resolvedOptions = typeof name === 'object' ? name : options;

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();

  if (!resolvedName) {
    const profiles = await config.getProfiles(resolvedAgent);
    if (profiles.length === 0) {
      note(`No profiles found for ${resolvedAgent}. Let's create one.`, 'New Profile');

      const suggestedName = generateName();
      const nameResponse = await text({
        message: 'Enter a name for this profile:',
        placeholder: suggestedName,
        initialValue: suggestedName,
        validate(value) {
          return validateProfileName(value) || undefined;
        },
      });

      if (isCancel(nameResponse)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }

      const newName = nameResponse as string;
      await config.createProfile(resolvedAgent, newName);
      note(`Created profile ${color.cyan(newName)}`, 'Profile Created');
      resolvedName = slugify(newName);
    } else {
      const response = await select({
        message: 'Select a profile to activate:',
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
      resolvedName = response as string;
    }
  } else {
    const validationError = validateProfileName(resolvedName);
    if (validationError) {
      console.error(color.red(validationError));
      process.exit(1);
    }
    resolvedName = slugify(resolvedName);
  }
  if (!resolvedName) {
    console.error(color.red('Profile name is required.'));
    process.exit(1);
  }

  const cwd = process.cwd();
  const envrcPath = path.join(cwd, '.envrc');
  const managedEnvrcPath = await resolveManagedEnvrcPath(cwd);
  const profileDir = path.join(config.getContentDir(), resolvedAgent, resolvedName);

  try {
    await fs.access(profileDir);
  } catch {
    console.error(color.red(`Profile '${resolvedName}' not found for agent '${resolvedAgent}'`));
    process.exit(1);
  }

  let envrcContent = '';
  try {
    envrcContent = await fs.readFile(envrcPath, 'utf-8');
  } catch {
    envrcContent = '';
  }

  const nextEnvrc = ensureBootstrapBlock(envrcContent);
  await fs.writeFile(envrcPath, nextEnvrc);

  let managedContent = '';
  try {
    managedContent = await fs.readFile(managedEnvrcPath, 'utf-8');
  } catch {
    managedContent = '';
  }

  const envVar = SUPPORTED_TOOLS[resolvedAgent].envVar;
  const profilePath = toShellPath(profileDir);
  const nextManaged = updateAgentBlock(managedContent, resolvedAgent, envVar, profilePath);
  await fs.writeFile(managedEnvrcPath, nextManaged);

  if (resolvedOptions?.allow) {
    try {
      await runDirenvAllow();
      outro(`Activated ${color.cyan(resolvedName)} profile for ${resolvedAgent} (direnv allowed).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(color.red(message));
      process.exit(1);
    }
  } else {
    outro(`Activated ${color.cyan(resolvedName)} profile for ${resolvedAgent}.`);
    console.log(color.dim("Run 'direnv allow' to apply changes."));
  }

  if (!isDirenvHookLoaded(process.env)) {
    const hint = getDirenvHookHint(process.env.SHELL);
    console.log(color.yellow('direnv hook not detected in this shell.'));
    console.log(color.dim(`Add this to your shell rc and restart: ${hint}`));
  }
}

export default defineCommand({
  meta: {
    name: 'set',
    description: 'Set the active profile for the current directory',
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
    allow: {
      type: 'boolean',
      alias: 'y',
      description: 'Run direnv allow after updating files',
    },
  },
  async run({ args }) {
    await setCommand(args.agent, args.name, { allow: args.allow });
  },
});
