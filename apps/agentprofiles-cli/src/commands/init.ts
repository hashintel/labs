import { defineCommand } from 'citty';
import { setupCommand } from './setup.js';

export default defineCommand({
  meta: {
    name: 'init',
    hidden: true,
  },
  async run() {
    await setupCommand();
  },
});
