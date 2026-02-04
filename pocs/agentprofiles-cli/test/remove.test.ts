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

const envrcFns = vi.hoisted(() => ({
  getActiveProfile: vi.fn(),
  removeAgentBlock: vi.fn(),
  hasAnyAgentBlocks: vi.fn(),
  removeBootstrapBlock: vi.fn(),
  isEffectivelyEmpty: vi.fn(),
  MANAGED_ENVRC_FILENAME: '.envrc.agentprofiles',
  LEGACY_MANAGED_ENVRC_FILENAME: '.envrc.agent',
}));

vi.mock('../src/lib/envrc.js', () => envrcFns);

const configMocks = vi.hoisted(() => ({
  init: vi.fn(),
  getProfiles: vi.fn(),
  getContentDir: vi.fn(),
}));

vi.mock('../src/lib/config.js', () => {
  class ConfigManager {
    init = configMocks.init;
    getProfiles = configMocks.getProfiles;
    getContentDir = configMocks.getContentDir;
  }
  return { ConfigManager };
});

vi.mock('../src/lib/prompts.js', () => ({
  promptForAgent: vi.fn(async () => 'claude'),
  promptForProfile: vi.fn(async () => 'default'),
}));

vi.mock('../src/types/index.js', () => ({
  SUPPORTED_TOOLS: {
    claude: { envVar: 'CLAUDE_CONFIG_DIR' },
  },
}));

describe('removeCommand legacy managed envrc handling', () => {
  const originalCwd = process.cwd;
  const tmpDir = '/tmp/agentprofiles-remove-test';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock cwd so paths are predictable
    // @ts-expect-error override for test
    process.cwd = () => tmpDir;

    configMocks.getProfiles.mockResolvedValue([
      { slug: 'default', name: 'Default', agent: 'claude' },
    ]);
    configMocks.getContentDir.mockReturnValue('/profiles');
    fsMocks.rm.mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    // @ts-expect-error restore
    process.cwd = originalCwd;
  });

  it('migrates legacy managed envrc before reading when only legacy file exists', async () => {
    const managedPath = path.join(tmpDir, envrcFns.MANAGED_ENVRC_FILENAME);
    const legacyPath = path.join(tmpDir, envrcFns.LEGACY_MANAGED_ENVRC_FILENAME);
    const profileDir = path.join('/profiles', 'claude', 'default');

    // access behavior by path:
    // - profileDir exists
    // - managedPath (nextPath) is missing
    // - legacyPath exists
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fsMocks.access.mockImplementation(async (p: string) => {
      if (p === profileDir) return;
      if (p === managedPath) throw enoent;
      if (p === legacyPath) return;
      return;
    });

    // Simulate rename failing so that we exercise the copy+delete migration path
    fsMocks.rename.mockRejectedValueOnce(new Error('rename failed'));
    fsMocks.readFile.mockImplementation(async (p: string) => {
      if (p === legacyPath) return 'legacy-content';
      if (p === managedPath) return 'managed-content';
      return '';
    });
    fsMocks.writeFile.mockResolvedValue(undefined as any);
    fsMocks.unlink.mockResolvedValue(undefined as any);

    envrcFns.getActiveProfile.mockReturnValue('default');
    envrcFns.removeAgentBlock.mockReturnValue('next-managed');
    envrcFns.hasAnyAgentBlocks.mockReturnValue(true);

    prompts.confirm.mockResolvedValue(true);

    const { removeCommand } = await import('../src/commands/remove.js');
    await removeCommand('claude', 'default');

    // Legacy should have been migrated to managed file
    expect(fsMocks.readFile).toHaveBeenCalledWith(legacyPath, 'utf-8');
    expect(fsMocks.writeFile).toHaveBeenCalledWith(managedPath, 'legacy-content');
    expect(fsMocks.unlink).toHaveBeenCalledWith(legacyPath);

    // And the managed file should be used for reading/updating
    expect(fsMocks.readFile).toHaveBeenCalledWith(managedPath, 'utf-8');
    expect(fsMocks.writeFile).toHaveBeenCalledWith(managedPath, 'next-managed');
  });

  it('uses rename migration path when legacy file exists and rename succeeds', async () => {
    const managedPath = path.join(tmpDir, envrcFns.MANAGED_ENVRC_FILENAME);
    const legacyPath = path.join(tmpDir, envrcFns.LEGACY_MANAGED_ENVRC_FILENAME);
    const profileDir = path.join('/profiles', 'claude', 'default');

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fsMocks.access.mockImplementation(async (p: string) => {
      if (p === profileDir) return;
      if (p === managedPath) throw enoent;
      if (p === legacyPath) return;
      return;
    });

    fsMocks.rename.mockResolvedValue(undefined as any);
    fsMocks.readFile.mockImplementation(async (p: string) => {
      if (p === managedPath) return 'managed-content';
      if (p === legacyPath) return 'legacy-content';
      return '';
    });
    fsMocks.writeFile.mockResolvedValue(undefined as any);
    fsMocks.unlink.mockResolvedValue(undefined as any);

    envrcFns.getActiveProfile.mockReturnValue('default');
    envrcFns.removeAgentBlock.mockReturnValue('next-managed');
    envrcFns.hasAnyAgentBlocks.mockReturnValue(true);
    prompts.confirm.mockResolvedValue(true);

    const { removeCommand } = await import('../src/commands/remove.js');
    await removeCommand('claude', 'default');

    expect(fsMocks.rename).toHaveBeenCalledWith(legacyPath, managedPath);
    expect(fsMocks.readFile).toHaveBeenCalledWith(managedPath, 'utf-8');
    expect(fsMocks.readFile).not.toHaveBeenCalledWith(legacyPath, 'utf-8');
    expect(fsMocks.unlink).not.toHaveBeenCalledWith(legacyPath);
    expect(fsMocks.writeFile).not.toHaveBeenCalledWith(managedPath, 'legacy-content');
    expect(fsMocks.writeFile).toHaveBeenCalledWith(managedPath, 'next-managed');
  });
});
