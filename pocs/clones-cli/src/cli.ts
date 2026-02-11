import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';
import { renderBanner, renderInfo } from './lib/banner.js';
import { hasSubcommandArg } from './lib/cli-args.js';
import { checkForUpdates } from './lib/update.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Check if --quiet flag is present
const isQuiet = process.argv.includes('--quiet') || process.argv.includes('-q');

// Render banner and info (unless --quiet)
if (!isQuiet) {
  renderBanner();
  renderInfo(pkg);
}

// Check for updates (non-blocking, deferred notification)
checkForUpdates(pkg).catch(() => {});

const main = defineCommand({
  meta: {
    name: 'clones',
    version: pkg.version,
    description: pkg.description,
  },
  subCommands: {
    add: () => import('./commands/add.js').then((m) => m.default),
    auth: () => import('./commands/auth.js').then((m) => m.default),
    doctor: () => import('./commands/doctor.js').then((m) => m.default),
    init: () => import('./commands/init.js').then((m) => m.default),
    setup: () => import('./commands/init.js').then((m) => m.default),
    index: () => import('./commands/index.js').then((m) => m.default),
    list: () => import('./commands/list.js').then((m) => m.default),
    ls: () => import('./commands/list.js').then((m) => m.default),
    rm: () => import('./commands/rm.js').then((m) => m.default),
    sync: () => import('./commands/sync.js').then((m) => m.default),
    search: () => import('./commands/search.js').then((m) => m.default),
  },
  // Default: run interactive browser when no subcommand given
  async run({ rawArgs }) {
    if (hasSubcommandArg(rawArgs)) {
      return;
    }
    const { default: browse } = await import('./commands/browse.js');
    await browse.run?.({ args: {} } as unknown as Parameters<typeof browse.run>[0]);
  },
});

const isInitCommand = process.argv.some((arg) => arg === 'init' || arg === 'setup');
const isHelpOrVersion = process.argv.some(
  (arg) => arg === '--help' || arg === '-h' || arg === '--version' || arg === '-V'
);

if (!isInitCommand && !isHelpOrVersion) {
  const { ensureInitialized } = await import('./lib/onboarding.js');
  await ensureInitialized();
}

runMain(main);
