import { defineCommand } from 'citty';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, SHARED_DIRECTORIES } from '../types/index.js';
import color from 'picocolors';

export async function statusCommand() {
  const config = new ConfigManager();
  await config.init();

  console.log(color.bold('\n📊 Agent Profiles Status\n'));

  // Show agent statuses
  console.log(color.bold('Agents:'));
  for (const [agentKey, agentDef] of Object.entries(SUPPORTED_TOOLS)) {
    const status = await config.getSymlinkStatus(agentKey);
    const activeProfile = await config.getActiveProfile(agentKey);

    let statusLine = `  ${color.bold(agentDef.description)} (${agentKey})`;

    if (status === 'active') {
      const displayName = activeProfile === '_base' ? 'Base profile' : activeProfile;
      statusLine += ` → ${color.cyan(displayName)}`;
    } else if (status === 'unmanaged') {
      statusLine += ` → ${color.dim('Not managed (run setup to adopt)')}`;
    } else if (status === 'missing') {
      statusLine += ` → ${color.dim('Not installed')}`;
    } else if (status === 'broken') {
      statusLine += ` → ${color.red('Broken symlink')}`;
    } else if (status === 'external') {
      statusLine += ` → ${color.yellow('Symlink points outside managed profiles')}`;
    }

    console.log(statusLine);
  }

  // Show shared directory statuses
  console.log(color.bold('\nShared Directories:'));
  for (const [, sharedDir] of Object.entries(SHARED_DIRECTORIES)) {
    const status = await config.getSharedDirStatus(sharedDir.name);

    let statusLine = `  ${color.bold(sharedDir.description)} (${sharedDir.globalPath})`;

    if (status === 'active') {
      statusLine += ` → ${color.cyan('Managed')}`;
    } else if (status === 'unmanaged') {
      statusLine += ` → ${color.dim('Not managed')}`;
    } else if (status === 'missing') {
      statusLine += ` → ${color.dim('Not present')}`;
    } else if (status === 'broken') {
      statusLine += ` → ${color.red('Broken symlink')}`;
    } else if (status === 'external') {
      statusLine += ` → ${color.yellow('Symlink points outside managed location')}`;
    }

    console.log(statusLine);
  }

  console.log();
}

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show agent profile status',
  },
  async run() {
    await statusCommand();
  },
});

