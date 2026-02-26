import { defineCommand } from 'citty';
import { outro, select, text, confirm, isCancel, cancel, note } from '@clack/prompts';
import { ConfigManager } from '../lib/config.js';
import { SUPPORTED_TOOLS, BASE_PROFILE_SLUG } from '../types/index.js';
import color from 'picocolors';
import { validateNewProfileName, validateProfileName, slugify } from '../lib/validation.js';
import { joyful } from 'joyful';
import { promptForAgent } from '../lib/prompts.js';
import { hasCacheDirs, inspectAgentCacheDirs, clearCacheDirs } from '../lib/cache.js';

async function maybeClearCache(agent: string, clearCacheFlag: boolean): Promise<void> {
  if (!clearCacheFlag || !hasCacheDirs(agent)) return;

  const info = await inspectAgentCacheDirs(agent);
  if (!info) return;

  const existingSafe = info.safe.filter((d) => d.exists);
  const existingOptional = info.optional.filter((d) => d.exists);

  if (existingSafe.length === 0 && existingOptional.length === 0) return;

  // Auto-clear safe dirs
  if (existingSafe.length > 0) {
    const results = await clearCacheDirs(existingSafe);
    for (const r of results) {
      if (r.cleared) {
        console.log(color.green(`  ✓ Cleared ${r.dir.label}`));
      }
    }
  }

  // Prompt for optional dirs
  for (const dir of existingOptional) {
    const shouldClear = await confirm({
      message: `Also clear ${dir.dir.label}? ${color.dim('(loses prefs/history)')}`,
      initialValue: false,
    });

    if (isCancel(shouldClear)) break;

    if (shouldClear) {
      const results = await clearCacheDirs([dir]);
      for (const r of results) {
        if (r.cleared) {
          console.log(color.green(`  ✓ Cleared ${r.dir.label}`));
        }
      }
    }
  }
}

async function batchSwitchAll(profileName: string, clearCache = false): Promise<void> {
  const config = new ConfigManager();
  await config.init();
  const resolvedProfileName =
    profileName === 'base' || profileName === 'unset' ? BASE_PROFILE_SLUG : profileName;

  const results = {
    switched: [] as string[],
    skipped: [] as string[],
    errors: [] as { agent: string; error: string }[],
  };

  for (const agent of Object.keys(SUPPORTED_TOOLS)) {
    try {
      // Check if agent is managed
      const status = await config.getSymlinkStatus(agent);
      if (status !== 'active' && status !== 'broken') {
        results.skipped.push(`${agent} (not managed)`);
        continue;
      }

      // Check if profile exists for this agent
      const profiles = await config.getProfiles(agent);
      const profileExists = profiles.some((p) => p.slug === resolvedProfileName);

      if (!profileExists) {
        results.skipped.push(`${agent} (profile '${resolvedProfileName}' not found)`);
        continue;
      }

      // Switch the profile
      await config.switchProfile(agent, resolvedProfileName);
      await maybeClearCache(agent, clearCache);
      results.switched.push(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push({ agent, error: message });
    }
  }

  // Print summary
  if (results.switched.length > 0) {
    console.log(color.green(`✓ Switched ${results.switched.length} agent(s):`));
    results.switched.forEach((agent) => console.log(`  - ${agent}`));
  }

  if (results.skipped.length > 0) {
    console.log(color.dim(`⊘ Skipped ${results.skipped.length} agent(s):`));
    results.skipped.forEach((msg) => console.log(`  - ${msg}`));
  }

  if (results.errors.length > 0) {
    console.log(color.red(`✗ Errors (${results.errors.length}):`));
    results.errors.forEach(({ agent, error }) => console.log(`  - ${agent}: ${error}`));
    process.exit(1);
  }

  outro(
    `Activated ${color.cyan(resolvedProfileName)} profile for ${results.switched.length} agent(s).`
  );
}

export async function setCommand(agent?: string, name?: string, clearCache = false) {
  const resolvedAgent: string = agent ?? (await promptForAgent('Select agent to set profile for:'));

  if (!SUPPORTED_TOOLS[resolvedAgent]) {
    console.error(color.red(`Unsupported agent: ${resolvedAgent}`));
    process.exit(1);
  }

  const config = new ConfigManager();
  await config.init();

  // Check that agent is managed
  const status = await config.getSymlinkStatus(resolvedAgent);
  if (status === 'unmanaged') {
    console.error(
      color.red(`Agent '${resolvedAgent}' is not managed. Run 'agentprofiles setup' first.`)
    );
    process.exit(1);
  }
  if (status === 'missing') {
    console.error(color.red(`Agent '${resolvedAgent}' is not installed.`));
    process.exit(1);
  }

  let resolvedName: string | undefined = name;

  if (!resolvedName) {
    const profiles = await config.getProfiles(resolvedAgent);
    const activeProfile = await config.getActiveProfile(resolvedAgent);

    if (profiles.length === 0) {
      note(`No profiles found for ${resolvedAgent}. Let's create one.`, 'New Profile');

      const suggestedName = joyful();
      const nameResponse = await text({
        message: 'Enter a name for this profile:',
        placeholder: suggestedName,
        initialValue: suggestedName,
        validate(value) {
          if (!value) return 'Profile name is required.';
          return validateNewProfileName(value) || undefined;
        },
      });

      if (isCancel(nameResponse)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }

      const newName = nameResponse as string;
      await config.createProfile(resolvedAgent, newName);
      note(`Created profile ${color.cyan(newName)}`, 'Profile Created');
      resolvedName = slugify(newName);
    } else {
      const selectableProfiles = profiles.filter((p) => p.slug !== BASE_PROFILE_SLUG);
      const response = await select({
        message: 'Select a profile to activate:',
        options: [
          {
            value: BASE_PROFILE_SLUG,
            label: 'Unset (reset to base profile)',
            hint: activeProfile === BASE_PROFILE_SLUG ? '(active)' : 'switch to _base',
          },
          ...selectableProfiles.map((p) => ({
            value: p.slug,
            label: p.name,
            hint: p.slug === activeProfile ? '(active)' : p.description,
          })),
        ],
      });

      if (isCancel(response)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }
      resolvedName = response as string;
    }
  } else {
    // Handle 'base' alias for BASE_PROFILE_SLUG
    if (resolvedName === 'base' || resolvedName === 'unset') {
      resolvedName = BASE_PROFILE_SLUG;
    } else {
      const validationError = validateProfileName(resolvedName);
      if (validationError) {
        console.error(color.red(validationError));
        process.exit(1);
      }
      resolvedName = slugify(resolvedName);
    }
  }

  if (!resolvedName) {
    console.error(color.red('Profile name is required.'));
    process.exit(1);
  }

  try {
    if (resolvedName === BASE_PROFILE_SLUG) {
      await config.ensureBaseProfileLayout(resolvedAgent);
    }
    await config.switchProfile(resolvedAgent, resolvedName);
    await maybeClearCache(resolvedAgent, clearCache);
    outro(`Activated ${color.cyan(resolvedName)} profile for ${resolvedAgent}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(message));
    process.exit(1);
  }
}

export default defineCommand({
  meta: {
    name: 'set',
    description: 'Set the active profile for an agent',
  },
  args: {
    agent: {
      type: 'positional',
      description: 'Agent name',
      required: false,
    },
    name: {
      type: 'positional',
      description: 'Profile name (or "base"/"unset" for base profile)',
      required: false,
    },
    all: {
      type: 'boolean',
      description: 'Switch all managed agents to the same profile',
      required: false,
    },
    'clear-cache': {
      type: 'boolean',
      description: 'Clear cache/state directories after switching (opencode, amp)',
      required: false,
    },
  },
  async run({ args }) {
    const clearCache = !!args['clear-cache'];

    // Handle --all flag: agentprofiles set --all <profile>
    if (args.all) {
      const profileName = args.agent; // When --all is used, first positional is the profile name
      if (!profileName) {
        console.error(color.red('Profile name is required when using --all flag'));
        process.exit(1);
      }
      await batchSwitchAll(profileName, clearCache);
      return;
    }

    // Handle shorthand: agentprofiles set <profile> (no agent arg, treated as --all)
    if (args.agent && !args.name) {
      // Check if this looks like a profile name (not an agent name)
      // If agent is not in SUPPORTED_TOOLS, treat it as a profile name for --all
      if (!SUPPORTED_TOOLS[args.agent]) {
        await batchSwitchAll(args.agent, clearCache);
        return;
      }
    }

    // Normal flow: agentprofiles set <agent> [name]
    await setCommand(args.agent, args.name, clearCache);
  },
});
