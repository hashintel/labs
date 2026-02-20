import { defineCommand } from 'citty';
import { removeCommand } from './remove.js';

export default defineCommand({
  meta: {
    name: 'rm',
    hidden: true,
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name (claude/opencode)',
      required: true,
    },
    name: {
      type: 'positional',
      description: 'Profile name',
      required: false,
    },
  },
  async run({ args }) {
    await removeCommand(args.agent, args.name);
  },
});
