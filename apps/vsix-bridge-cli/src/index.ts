import * as p from '@clack/prompts';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { renderBanner, renderInfo } from './lib/banner.js';
import { checkForUpdates } from './lib/update.js';
import { ensureInitialized, runOnboarding } from './lib/onboarding.js';
import { runSync } from './commands/sync.js';
import { runInstall } from './commands/install.js';
import { runStatus } from './commands/status.js';
import { runDetect } from './commands/detect.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const COMMANDS = ['sync', 'install', 'status', 'detect', 'init'] as const;
type Command = (typeof COMMANDS)[number];

interface ParsedArgs {
  command: Command | null;
  to: string[];
  dryRun: boolean;
  syncRemovals: boolean;
  help: boolean;
  quiet: boolean;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      to: { type: 'string', multiple: true, default: [] },
      'dry-run': { type: 'boolean', default: false },
      'sync-removals': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
    },
    allowPositionals: true,
  });

  const commandArg = positionals[0] as Command | undefined;
  const command = commandArg && COMMANDS.includes(commandArg) ? commandArg : null;

  return {
    command,
    to: values.to ?? [],
    dryRun: values['dry-run'] ?? false,
    syncRemovals: values['sync-removals'] ?? false,
    help: values.help ?? false,
    quiet: values.quiet ?? false,
  };
}

function showHelp(): void {
  console.log(`
vsix-bridge - Sync VS Code extensions to fork IDEs

Usage:
  vsix-bridge <command> [options]

Commands:
  sync      Download compatible VSIX files from Microsoft Marketplace
  install   Install synced VSIX files into target IDEs
  status    Show extension diff between VS Code and forks
  detect    Auto-detect installed IDEs and their configuration
  init      Initialize vsix-bridge configuration

Options:
  --to <ide>         Target IDE(s) (cursor, antigravity, windsurf)
  --dry-run          Show what would be done without doing it
  --sync-removals    Uninstall extensions in fork not in VS Code
  -q, --quiet        Suppress banner output
  -h, --help         Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.quiet && !args.help) {
    renderBanner();
    renderInfo(pkg);
  }

  checkForUpdates(pkg).catch(() => {});

  if (args.help || !args.command) {
    showHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (args.command === 'init') {
    await runOnboarding({ isRerun: true });
    return;
  }

  await ensureInitialized();

  p.intro('vsix-bridge');

  switch (args.command) {
    case 'sync':
      await runSync({ to: args.to });
      break;
    case 'install':
      await runInstall({
        to: args.to,
        dryRun: args.dryRun,
        syncRemovals: args.syncRemovals,
      });
      break;
    case 'status':
      await runStatus({ to: args.to });
      break;
    case 'detect':
      await runDetect();
      break;
  }

  p.outro('Done');
}

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/vsix-bridge');

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
