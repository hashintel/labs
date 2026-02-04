import { defineCommand } from 'citty';
import { runOnboarding } from '../lib/onboarding.js';

export async function setupCommand(): Promise<void> {
  await runOnboarding({ isRerun: true });
}

export default defineCommand({
  meta: {
    name: 'setup',
    description: 'Initialize the agentprofiles system (alias: init)',
  },
  async run() {
    await setupCommand();
  },
});
