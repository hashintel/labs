import { defineCommand } from 'citty';
import { runOnboarding } from '../lib/onboarding.js';

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize clones configuration',
  },
  async run() {
    await runOnboarding({ isRerun: true });
  },
});
