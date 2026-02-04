import { defineCommand } from 'citty';
import { outro } from '@clack/prompts';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  removeAgentBlock,
  removeBootstrapBlock,
  hasAnyAgentBlocks,
  isEffectivelyEmpty,
  MANAGED_ENVRC_FILENAME,
  LEGACY_MANAGED_ENVRC_FILENAME,
} from '../lib/envrc.js';
import { spawn } from 'node:child_process';
import { promptForAgent } from '../lib/prompts.js';

type UnsetOptions = {
  allow?: boolean;
};

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

export async function unsetCommand(agent?: string, options?: UnsetOptions) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to unset:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const cwd = process.cwd();
  const envrcPath = path.join(cwd, '.envrc');
  const managedEnvrcPath = await resolveManagedEnvrcPath(cwd);

  let managedContent = '';
  try {
    managedContent = await fs.readFile(managedEnvrcPath, 'utf-8');
  } catch {
    managedContent = '';
  }

  const nextManaged = removeAgentBlock(managedContent, resolvedAgent);

  if (!hasAnyAgentBlocks(nextManaged)) {
    try {
      await fs.unlink(managedEnvrcPath);
    } catch {
      // File may not exist
    }

    try {
      const envrcContent = await fs.readFile(envrcPath, 'utf-8');
      const withoutBootstrap = removeBootstrapBlock(envrcContent);

      if (isEffectivelyEmpty(withoutBootstrap)) {
        await fs.unlink(envrcPath);
      } else {
        await fs.writeFile(envrcPath, withoutBootstrap + '\n');
      }
    } catch {
      // No .envrc to update
    }
  } else {
    await fs.writeFile(managedEnvrcPath, nextManaged);
  }

  if (options?.allow) {
    try {
      await runDirenvAllow();
      outro(`Unset ${resolvedAgent} profile (direnv allowed).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(color.red(message));
      process.exit(1);
    }
  } else {
    outro(`Unset ${resolvedAgent} profile.`);
    console.log(color.dim("Run 'direnv allow' to apply changes."));
  }
}

export default defineCommand({
  meta: {
    name: 'unset',
    description: 'Unset the active profile for the current directory',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
    allow: {
      type: 'boolean',
      alias: 'y',
      description: 'Run direnv allow after updating files',
    },
  },
  async run({ args }) {
    await unsetCommand(args.agent, { allow: args.allow });
  },
});
