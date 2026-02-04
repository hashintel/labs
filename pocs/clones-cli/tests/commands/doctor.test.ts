import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureConfigDir = vi.fn();
const getRegistryPath = vi.fn(() => '/tmp/registry.toml');
const getLocalStatePath = vi.fn(() => '/tmp/local.json');

const emptyRegistry = { version: '1.0.0', repos: [], tombstones: [] };
const emptyLocalState = { version: '1.0.0', repos: {} };

const createEmptyRegistry = vi.fn(() => emptyRegistry);
const readRegistryFile = vi.fn();
const parseRegistryContent = vi.fn();
const stringifyRegistryToml = vi.fn(() => '');
const writeRegistry = vi.fn();

const createEmptyLocalState = vi.fn(() => emptyLocalState);
const writeLocalState = vi.fn();

const normalizeRegistry = vi.fn(() => ({ data: emptyRegistry, issues: [] }));
const normalizeLocalState = vi.fn(() => ({ data: emptyLocalState, issues: [] }));

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  intro: prompts.intro,
  outro: prompts.outro,
  text: prompts.text,
  confirm: prompts.confirm,
  log: prompts.log,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('../../src/lib/config.js', () => ({
  ensureConfigDir,
  getRegistryPath,
  getLocalStatePath,
}));

vi.mock('../../src/lib/registry.js', () => ({
  createEmptyRegistry,
  parseRegistryContent,
  readRegistryFile,
  stringifyRegistryToml,
  writeRegistry,
}));

vi.mock('../../src/lib/local-state.js', () => ({
  createEmptyLocalState,
  writeLocalState,
}));

vi.mock('../../src/lib/schema.js', () => ({
  normalizeRegistry,
  normalizeLocalState,
}));

const { default: doctorCommand } = await import('../../src/commands/doctor.js');

describe('clones doctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates missing registry and local state without prompting', async () => {
    readRegistryFile.mockResolvedValue(null);

    await doctorCommand.run?.({ args: {} } as any);

    expect(ensureConfigDir).toHaveBeenCalledTimes(1);
    expect(writeRegistry).toHaveBeenCalledWith(emptyRegistry);
    expect(writeLocalState).toHaveBeenCalledWith(emptyLocalState);
    expect(prompts.text).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });
});
