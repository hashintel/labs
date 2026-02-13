import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

const prompts = vi.hoisted(() => ({
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
}));

vi.mock('@clack/prompts', () => prompts);

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ default: fsMocks }));

const configMocks = vi.hoisted(() => ({
  init: vi.fn(),
  getProfiles: vi.fn(),
  getContentDir: vi.fn(),
  getActiveProfile: vi.fn(),
}));

vi.mock('../src/lib/config.js', () => {
  class ConfigManager {
    init = configMocks.init;
    getProfiles = configMocks.getProfiles;
    getContentDir = configMocks.getContentDir;
    getActiveProfile = configMocks.getActiveProfile;
  }
  return { ConfigManager };
});

vi.mock('../src/lib/prompts.js', () => ({
  promptForAgent: vi.fn(async () => 'claude'),
  promptForProfile: vi.fn(async () => 'default'),
}));

vi.mock('../src/types/index.js', () => ({
  SUPPORTED_TOOLS: {
    claude: { globalConfigDir: '.claude', description: 'Claude Code' },
  },
  BASE_PROFILE_SLUG: '_base',
  SHARED_PROFILE_SLUG: '_shared',
}));

describe('removeCommand', () => {
  const tmpDir = '/tmp/agentprofiles-remove-test';
  const originalExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error mock process.exit to throw so execution stops
    process.exit = vi.fn(() => {
      throw new Error('process.exit called');
    });

    configMocks.getProfiles.mockResolvedValue([
      { slug: 'default', name: 'Default', agent: 'claude' },
      { slug: '_base', name: '_base', agent: 'claude' },
    ]);
    configMocks.getContentDir.mockReturnValue('/profiles');
    configMocks.getActiveProfile.mockResolvedValue(null);
    fsMocks.rm.mockResolvedValue(undefined as any);
    fsMocks.access.mockResolvedValue(undefined as any);
    prompts.confirm.mockResolvedValue(true);
  });

  afterEach(() => {
    // @ts-expect-error restore
    process.exit = originalExit;
  });

  it('removes a profile when not active', async () => {
    const profileDir = path.join('/profiles', 'claude', 'default');

    const { removeCommand } = await import('../src/commands/remove.js');
    await removeCommand('claude', 'default');

    expect(fsMocks.rm).toHaveBeenCalledWith(profileDir, { recursive: true, force: true });
    expect(prompts.outro).toHaveBeenCalled();
  });

  it('prevents removal of _base profile', async () => {
    const { removeCommand } = await import('../src/commands/remove.js');
    try {
      await removeCommand('claude', '_base');
    } catch {
      // Expected to throw when process.exit is called
    }

    expect(fsMocks.rm).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prevents removal of active profile', async () => {
    configMocks.getActiveProfile.mockResolvedValue('default');

    const { removeCommand } = await import('../src/commands/remove.js');
    try {
      await removeCommand('claude', 'default');
    } catch {
      // Expected to throw when process.exit is called
    }

    expect(fsMocks.rm).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('prevents removal of _shared reserved directory', async () => {
    const { removeCommand } = await import('../src/commands/remove.js');
    try {
      await removeCommand('claude', '_shared');
    } catch {
      // Expected to throw when process.exit is called
    }

    expect(fsMocks.rm).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
