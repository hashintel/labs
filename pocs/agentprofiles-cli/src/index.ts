import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';
import { renderBanner, renderInfo } from './lib/banner.js';
import { checkForUpdates } from './lib/update.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const isQuiet = process.argv.includes('--quiet') || process.argv.includes('-q');

if (!isQuiet) {
  renderBanner();
  renderInfo(pkg);
}

checkForUpdates(pkg).catch(() => {});

const knownSubcommands = [
  'setup',
  'init',
  'list',
  'add',
  'create',
  'edit',
  'remove',
  'rm',
  'set',
  'unset',
  'status',
  'release',
];

const args = process.argv.slice(2);
const hasSubcommand = args.some(
  (arg) => knownSubcommands.includes(arg) || arg === '--help' || arg === '-h'
);
const isHelpOrVersion = args.some(
  (arg) => arg === '--help' || arg === '-h' || arg === '--version' || arg === '-V'
);
const isInitCommand = args.some((arg) => arg === 'init' || arg === 'setup');

if (!isInitCommand && !isHelpOrVersion) {
  const { ensureInitialized } = await import('./lib/onboarding.js');
  await ensureInitialized();
}

if (!hasSubcommand && !isHelpOrVersion) {
  const { showMainMenu } = await import('./lib/main-menu.js');
  await showMainMenu();
} else {
  const main = defineCommand({
    meta: {
      name: 'agentprofiles',
      version: pkg.version,
      description: pkg.description,
    },
    subCommands: {
      setup: () => import('./commands/setup.js').then((m) => m.default),
      init: () => import('./commands/init.js').then((m) => m.default),
      list: () => import('./commands/list.js').then((m) => m.default),
      add: () => import('./commands/add.js').then((m) => m.default),
      create: () => import('./commands/create.js').then((m) => m.default),
      edit: () => import('./commands/edit.js').then((m) => m.default),
      remove: () => import('./commands/remove.js').then((m) => m.default),
      rm: () => import('./commands/rm.js').then((m) => m.default),
      set: () => import('./commands/set.js').then((m) => m.default),
      unset: () => import('./commands/unset.js').then((m) => m.default),
      status: () => import('./commands/status.js').then((m) => m.default),
      release: () => import('./commands/release.js').then((m) => m.default),
    },
  });

  runMain(main);
}
