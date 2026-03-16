import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const prompts = vi.hoisted(() => ({
  confirm: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@clack/prompts', () => prompts);

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

describe('doctorCommand managed convention repair', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-doctor-flow-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;

    prompts.confirm.mockResolvedValue(true);
    prompts.select.mockResolvedValue('skip');

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('repairs CLI-owned instruction links and leaves unrelated broken symlinks alone', async () => {
    const { ConfigManager } = await import('../src/lib/config.js');
    const { doctorCommand } = await import('../src/commands/doctor.js');

    const config = new ConfigManager();
    await config.ensureConfigDir();
    await config.ensureSharedDirManaged('agents');

    await fs.writeFile(path.join(contentDir, '_agents', 'AGENTS.md'), '# Shared instructions\n');

    for (const profile of ['_base', 'work']) {
      const profileDir = path.join(contentDir, 'claude', profile);
      await fs.mkdir(profileDir, { recursive: true });
      await fs.writeFile(
        path.join(profileDir, 'meta.json'),
        JSON.stringify({ name: profile, slug: profile, agent: 'claude' }, null, 2)
      );
    }

    await config.ensureManagedContentConventions();

    const baseInstruction = path.join(contentDir, 'claude', '_base', 'CLAUDE.md');
    const workInstruction = path.join(contentDir, 'claude', 'work', 'CLAUDE.md');
    await fs.unlink(baseInstruction);

    const pluginDir = path.join(contentDir, 'claude', 'work', 'plugins');
    await fs.mkdir(pluginDir, { recursive: true });
    const unrelatedBrokenLink = path.join(pluginDir, 'custom-plugin');
    await fs.symlink('./missing-plugin', unrelatedBrokenLink);

    await doctorCommand();

    expect((await fs.lstat(baseInstruction)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(baseInstruction)).toBe('../../_agents/AGENTS.md');

    expect((await fs.lstat(workInstruction)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(workInstruction)).toBe('../_base/CLAUDE.md');

    expect((await fs.lstat(unrelatedBrokenLink)).isSymbolicLink()).toBe(true);
    await expect(fs.access(unrelatedBrokenLink)).rejects.toThrow();
  });
});
