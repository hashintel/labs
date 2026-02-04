import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../src/lib/config.js';
import { SUPPORTED_TOOLS } from '../src/types/index.js';

function snapshotEnv(keys: string[]) {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('ConfigManager contentDir resolution', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'XDG_CONFIG_HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;

  beforeEach(async () => {
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-config-test-'));
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('uses config.json contentDir (relative) when set', async () => {
    const configDir = path.join(tmpRoot, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir: 'content' }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();
    await config.init();

    expect(config.getContentDir()).toBe(path.join(configDir, 'content'));
  });

  it('AGENTPROFILES_CONTENT_DIR overrides config.json contentDir', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const overrideDir = path.join(tmpRoot, 'override');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir: 'content' }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = overrideDir;

    const config = new ConfigManager();
    await config.init();

    expect(config.getContentDir()).toBe(overrideDir);
  });

  it('ensureConfigDir loads existing config.json and creates tool dirs under contentDir', async () => {
    const configDir = path.join(tmpRoot, 'config');
    const contentDir = path.join(tmpRoot, 'content');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({ contentDir }, null, 2)
    );

    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    delete process.env.AGENTPROFILES_CONTENT_DIR;

    const config = new ConfigManager();
    await config.ensureConfigDir();

    expect(config.getContentDir()).toBe(contentDir);

    for (const agent of Object.keys(SUPPORTED_TOOLS)) {
      await expect(fs.access(path.join(contentDir, agent))).resolves.toBeUndefined();
    }
  });
});
