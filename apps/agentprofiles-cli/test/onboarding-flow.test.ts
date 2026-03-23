import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const prompts = vi.hoisted(() => {
  const spinnerApi = {
    start: vi.fn(),
    stop: vi.fn(),
  };

  return {
    intro: vi.fn(),
    note: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    cancel: vi.fn(),
    spinner: vi.fn(() => spinnerApi),
    outro: vi.fn(),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    spinnerApi,
  };
});

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

describe('runOnboarding deterministic setup', () => {
  const ENV_KEYS = ['AGENTPROFILES_CONFIG_DIR', 'AGENTPROFILES_CONTENT_DIR', 'HOME'];

  let envSnapshot: Record<string, string | undefined>;
  let tmpRoot: string;
  let tmpHome: string;
  let configDir: string;
  let contentDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    envSnapshot = snapshotEnv(ENV_KEYS);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentprofiles-onboarding-flow-test-'));
    tmpHome = path.join(tmpRoot, 'home');
    configDir = path.join(tmpRoot, 'config');
    contentDir = path.join(tmpRoot, 'content');

    await fs.mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
    process.env.AGENTPROFILES_CONFIG_DIR = configDir;
    process.env.AGENTPROFILES_CONTENT_DIR = contentDir;

    prompts.text.mockResolvedValue(contentDir);
    prompts.confirm.mockResolvedValue(false);
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates shared content, shared home symlink, and relative internal instruction links on a clean machine', async () => {
    const { runOnboarding } = await import('../src/lib/onboarding.js');

    await expect(runOnboarding({ isRerun: true })).resolves.toBe(true);

    const sharedDir = path.join(contentDir, '_agents');
    const sharedInstructions = path.join(sharedDir, 'AGENTS.md');
    const sharedHomeLink = path.join(tmpHome, '.agents');
    const contentGuide = path.join(contentDir, 'AGENTS.md');
    const ampBaseInstruction = path.join(contentDir, 'amp', '_base', 'AGENTS.md');
    const claudeBaseInstruction = path.join(contentDir, 'claude', '_base', 'CLAUDE.md');

    await expect(fs.access(sharedDir)).resolves.toBeUndefined();
    await expect(fs.access(sharedInstructions)).resolves.toBeUndefined();
    await expect(fs.access(contentGuide)).resolves.toBeUndefined();

    expect((await fs.lstat(sharedHomeLink)).isSymbolicLink()).toBe(true);
    const sharedHomeTarget = await fs.readlink(sharedHomeLink);
    expect(path.resolve(path.dirname(sharedHomeLink), sharedHomeTarget)).toBe(sharedDir);

    expect((await fs.lstat(ampBaseInstruction)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(ampBaseInstruction)).toBe('../../_agents/AGENTS.md');

    expect((await fs.lstat(claudeBaseInstruction)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(claudeBaseInstruction)).toBe('../../_agents/AGENTS.md');
  });
});
