import { defineCommand } from 'citty';
import { addCommand } from './add.js';

export default defineCommand({
  meta: {
    name: 'create',
    description: 'Create a new profile (alias for add)',
    hidden: true,
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name (claude/opencode)',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name',
      required: false,
    },
  },
  async run({ args }) {
    await addCommand(args.agent, args.name);
  },
});
