import { defineCommand } from 'citty';
import { select, confirm, isCancel, cancel, note, outro } from '@clack/prompts';
import { SUPPORTED_TOOLS } from '../types/index.js';
import color from 'picocolors';
import {
  agentsWithCacheDirs,
  inspectAgentCacheDirs,
  clearCacheDirs,
  formatBytes,
} from '../lib/cache.js';

export async function clearCacheCommand(agent?: string): Promise<void> {
  const eligible = agentsWithCacheDirs();

  let resolvedAgent = agent;

  if (!resolvedAgent) {
    const response = await select({
      message: 'Select agent to clear cache for:',
      options: eligible.map((key) => ({
        value: key,
        label: SUPPORTED_TOOLS[key]!.description,
        hint: key,
      })),
    });

    if (isCancel(response)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }
    resolvedAgent = response as string;
  }

  if (!eligible.includes(resolvedAgent)) {
    console.error(
      color.red(
        `Agent '${resolvedAgent}' does not have known cache directories. Eligible agents: ${eligible.join(', ')}`
      )
    );
    process.exit(1);
  }

  const info = await inspectAgentCacheDirs(resolvedAgent);
  if (!info) return;

  const allDirs = [...info.safe, ...info.optional];
  const existingDirs = allDirs.filter((d) => d.exists);

  if (existingDirs.length === 0) {
    outro(`No cache directories found for ${color.cyan(resolvedAgent)}. Nothing to clear.`);
    return;
  }

  // Show inventory
  const lines = allDirs.map((d) => {
    const status = d.exists ? formatBytes(d.sizeBytes) : color.dim('not found');
    const category = info.safe.includes(d) ? '' : color.yellow(' (optional)');
    return `${d.dir.label}${category}\n  ${color.dim(d.absolutePath)} — ${status}`;
  });
  note(lines.join('\n\n'), `${SUPPORTED_TOOLS[resolvedAgent]!.description} cache directories`);

  // Clear safe dirs
  const existingSafe = info.safe.filter((d) => d.exists);
  if (existingSafe.length > 0) {
    const shouldClear = await confirm({
      message: `Clear ${existingSafe.length} safe cache dir(s)?`,
      initialValue: true,
    });

    if (isCancel(shouldClear)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }

    if (shouldClear) {
      const results = await clearCacheDirs(existingSafe);
      for (const r of results) {
        if (r.cleared) {
          console.log(color.green(`  ✓ Cleared ${r.dir.label}`));
        } else if (r.error) {
          console.log(color.red(`  ✗ Failed to clear ${r.dir.label}: ${r.error}`));
        }
      }
    }
  }

  // Prompt for optional dirs individually
  const existingOptional = info.optional.filter((d) => d.exists);
  for (const dir of existingOptional) {
    const shouldClear = await confirm({
      message: `Clear ${dir.dir.label}? ${color.dim('(loses prefs/history)')}`,
      initialValue: false,
    });

    if (isCancel(shouldClear)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }

    if (shouldClear) {
      const results = await clearCacheDirs([dir]);
      for (const r of results) {
        if (r.cleared) {
          console.log(color.green(`  ✓ Cleared ${r.dir.label}`));
        } else if (r.error) {
          console.log(color.red(`  ✗ Failed to clear ${r.dir.label}: ${r.error}`));
        }
      }
    }
  }

  outro(`Cache cleared for ${color.cyan(resolvedAgent)}.`);
}

export default defineCommand({
  meta: {
    name: 'clear-cache',
    description: 'Clear cache and state directories for an agent',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name (opencode, amp)',
      required: false,
    },
  },
  async run({ args }) {
    await clearCacheCommand(args.agent);
  },
});
