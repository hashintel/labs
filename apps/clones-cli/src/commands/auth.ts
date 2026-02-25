import { defineCommand } from 'citty';
import * as p from '@clack/prompts';

export default defineCommand({
  meta: {
    name: 'auth',
    description: 'Manage GitHub authentication',
  },
  subCommands: {
    login: () => import('./auth/login.js').then((m) => m.default),
    logout: () => import('./auth/logout.js').then((m) => m.default),
    status: () => import('./auth/status.js').then((m) => m.default),
  },
  async run() {
    p.intro('clones auth');
    p.log.info('Use: clones auth login, clones auth logout, or clones auth status');
    p.outro('Done!');
  },
});
