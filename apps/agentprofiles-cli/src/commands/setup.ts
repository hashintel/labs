import { defineCommand } from 'citty';
import { runOnboarding } from '../lib/onboarding.js';

export async function setupCommand(): Promise<void> {
  const success = await runOnboarding({ isRerun: true });
  if (!success) {
    process.exit(1);
  }
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
