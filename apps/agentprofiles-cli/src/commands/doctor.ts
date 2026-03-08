import { defineCommand } from 'citty';
import { confirm, select } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, SHARED_DIRECTORIES, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function doctorCommand() {
  const config = new ConfigManager();
  await config.init();

  console.log(color.bold('\n🔧 Agent Profiles Doctor\n'));

  const issues: string[] = [];
  const fixes: string[] = [];

  // Check each agent
  for (const [agentKey, agentDef] of Object.entries(SUPPORTED_TOOLS)) {
    const status = await config.getSymlinkStatus(agentKey);
    const strategy = config.getAgentStrategy(agentKey);

    if (status === 'broken') {
      const globalPath = config.getGlobalConfigPath(agentKey);

      if (strategy === 'include') {
        // Include agents: 'broken' means one or more per-entry symlinks inside globalPath
        // are broken. The fix is to switch to _base which re-creates all managed entries.
        issues.push(
          `${agentDef.description} (${agentKey}): broken per-entry symlink(s) in ${globalPath}`
        );

        const choice = await select({
          message: `Fix broken include symlinks for ${color.cyan(agentKey)}?`,
          options: [
            { value: 'switch_base', label: 'Switch to _base profile (re-creates managed entries)' },
            { value: 'skip', label: 'Skip' },
          ],
        });

        if (choice === 'switch_base') {
          try {
            const baseDir = path.join(config.getContentDir(), agentKey, BASE_PROFILE_SLUG);
            await fs.access(baseDir);
            await config.switchProfile(agentKey, BASE_PROFILE_SLUG);
            fixes.push(`Switched ${agentKey} to _base profile (repaired broken entries)`);
          } catch {
            console.error(color.red(`  Error: _base profile not found for ${agentKey}`));
          }
        }
      } else {
        // Directory agents: 'broken' means the directory-level symlink is broken.
        issues.push(`${agentDef.description} (${agentKey}): broken symlink`);

        const choice = await select({
          message: `Fix broken symlink for ${color.cyan(agentKey)}?`,
          options: [
            { value: 'switch_base', label: 'Switch to _base profile' },
            { value: 'remove', label: 'Remove the symlink' },
            { value: 'skip', label: 'Skip' },
          ],
        });

        if (choice === 'switch_base') {
          try {
            const baseDir = path.join(config.getContentDir(), agentKey, BASE_PROFILE_SLUG);
            await fs.access(baseDir);
            await config.switchProfile(agentKey, BASE_PROFILE_SLUG);
            fixes.push(`Switched ${agentKey} to _base profile`);
          } catch {
            console.error(color.red(`  Error: _base profile not found for ${agentKey}`));
          }
        } else if (choice === 'remove') {
          try {
            await fs.unlink(globalPath);
            fixes.push(`Removed broken symlink for ${agentKey}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(color.red(`  Error removing symlink: ${msg}`));
          }
        }
      }
    }
  }

  // Check for missing _base profiles
  for (const [agentKey, agentDef] of Object.entries(SUPPORTED_TOOLS)) {
    const status = await config.getSymlinkStatus(agentKey);
    if (status === 'active') {
      const baseDir = path.join(config.getContentDir(), agentKey, BASE_PROFILE_SLUG);
      try {
        await fs.access(baseDir);
      } catch {
        issues.push(`${agentDef.description} (${agentKey}): missing _base profile`);
        const shouldCreate = await confirm({
          message: `Create empty _base profile for ${color.cyan(agentKey)}?`,
          initialValue: false,
        });
        if (shouldCreate) {
          try {
            await config.ensureBaseProfileLayout(agentKey);
            fixes.push(`Created _base profile for ${agentKey}`);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(color.red(`  Error creating _base: ${msg}`));
          }
        }
      }
    }
  }

  // Check for missing meta.json in active profiles
  for (const [agentKey] of Object.entries(SUPPORTED_TOOLS)) {
    const status = await config.getSymlinkStatus(agentKey);
    if (status === 'active') {
      const activeProfile = await config.getActiveProfile(agentKey);
      if (activeProfile) {
        const profileDir = path.join(config.getContentDir(), agentKey, activeProfile);
        const metaPath = path.join(profileDir, 'meta.json');
        try {
          await fs.access(metaPath);
        } catch {
          issues.push(`${agentKey}: missing meta.json in ${activeProfile} profile`);
          const shouldCreate = await confirm({
            message: `Create meta.json for ${color.cyan(agentKey)}/${color.cyan(activeProfile)}?`,
            initialValue: false,
          });
          if (shouldCreate) {
            try {
              const meta = {
                name: activeProfile,
                slug: activeProfile,
                agent: agentKey,
                description: 'Profile metadata (created by doctor)',
                created_at: new Date().toISOString(),
              };
              await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
              fixes.push(`Created meta.json for ${agentKey}/${activeProfile}`);
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              console.error(color.red(`  Error creating meta.json: ${msg}`));
            }
          }
        }
      }
    }
  }

  // Check shared directories
  for (const [, sharedDir] of Object.entries(SHARED_DIRECTORIES)) {
    const status = await config.getSharedDirStatus(sharedDir.name);
    if (status === 'missing') {
      issues.push(`Shared directory ${sharedDir.description}: missing symlink`);
      const shouldCreate = await confirm({
        message: `Create managed symlink for ${color.cyan(sharedDir.globalPath)}?`,
        initialValue: true,
      });
      if (shouldCreate) {
        try {
          const result = await config.ensureSharedDirManaged(sharedDir.name);
          if (result !== 'unchanged') {
            fixes.push(`Created managed symlink for ${sharedDir.description}`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(color.red(`  Error: ${msg}`));
        }
      }
    } else if (status === 'broken') {
      issues.push(`Shared directory ${sharedDir.description}: broken symlink`);
      const shouldRemove = await confirm({
        message: `Remove broken symlink for ${color.cyan(sharedDir.globalPath)}?`,
        initialValue: false,
      });
      if (shouldRemove) {
        try {
          const globalPath = config.getSharedDirGlobalPath(sharedDir.name);
          await fs.unlink(globalPath);
          fixes.push(`Removed broken symlink for ${sharedDir.description}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(color.red(`  Error: ${msg}`));
        }
      }
    }
  }

  const conventionIssues = await config.getManagedContentConventionIssues();
  if (conventionIssues.length > 0) {
    issues.push(...conventionIssues.map((issue) => `Managed content: ${issue}`));

    const shouldRepair = await confirm({
      message: 'Repair CLI-managed content conventions?',
      initialValue: true,
    });

    if (shouldRepair) {
      const appliedFixes = await config.ensureManagedContentConventions();
      fixes.push(...appliedFixes);
    }
  }

  // Summary
  console.log(color.bold('\n📋 Summary\n'));
  if (issues.length === 0) {
    console.log(color.green('✓ No issues found!'));
  } else {
    console.log(color.yellow(`Found ${issues.length} issue(s):`));
    issues.forEach((issue) => console.log(`  • ${issue}`));
  }

  if (fixes.length > 0) {
    console.log(color.green(`\nFixed ${fixes.length} issue(s):`));
    fixes.forEach((fix) => console.log(`  ✓ ${fix}`));
  }

  console.log();
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Scan for and repair issues with profiles and symlinks',
  },
  async run() {
    await doctorCommand();
  },
});
