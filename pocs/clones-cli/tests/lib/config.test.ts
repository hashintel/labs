import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readFileSync = vi.fn();
const existsSync = vi.fn();
const writeFile = vi.fn();
const rename = vi.fn();
const mkdir = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync,
  existsSync,
}));

vi.mock('node:fs/promises', () => ({
  writeFile,
  rename,
  mkdir,
}));

const { getSyncConcurrency, getGitHubToken, getGitHubUsername, getGitHubConfig } =
  await import('../../src/lib/config.js');

describe('getSyncConcurrency', () => {
  const env = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it('uses env override when set', () => {
    process.env.CLONES_SYNC_CONCURRENCY = '7';
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ sync: { concurrency: 2 } }));

    expect(getSyncConcurrency()).toBe(7);
  });

  it('uses sync.concurrency from config', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ sync: { concurrency: 5 } }));

    expect(getSyncConcurrency()).toBe(5);
  });

  it('uses syncConcurrency from config when present', () => {
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue(JSON.stringify({ syncConcurrency: 3 }));

    expect(getSyncConcurrency()).toBe(3);
  });

  it('returns undefined when config file is missing', () => {
    existsSync.mockReturnValue(false);

    expect(getSyncConcurrency()).toBeUndefined();
  });
});

describe('GitHub config functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGitHubToken', () => {
    it('returns token from config', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          github: { token: 'test-token-123', username: 'testuser' },
        })
      );

      expect(getGitHubToken()).toBe('test-token-123');
    });

    it('returns null when no token in config', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({}));

      expect(getGitHubToken()).toBeNull();
    });

    it('returns null when config file missing', () => {
      existsSync.mockReturnValue(false);

      expect(getGitHubToken()).toBeNull();
    });
  });

  describe('getGitHubUsername', () => {
    it('returns username from config', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          github: { token: 'test-token-123', username: 'testuser' },
        })
      );

      expect(getGitHubUsername()).toBe('testuser');
    });

    it('returns null when no username in config', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(JSON.stringify({}));

      expect(getGitHubUsername()).toBeNull();
    });
  });

  describe('getGitHubConfig', () => {
    it('returns full GitHub config', () => {
      existsSync.mockReturnValue(true);
      readFileSync.mockReturnValue(
        JSON.stringify({
          github: { token: 'test-token-123', username: 'testuser', syncStars: true },
        })
      );

      const config = getGitHubConfig();
      expect(config.token).toBe('test-token-123');
      expect(config.username).toBe('testuser');
      expect(config.syncStars).toBe(true);
    });

    it('returns defaults when config missing', () => {
      existsSync.mockReturnValue(false);

      const config = getGitHubConfig();
      expect(config.token).toBeUndefined();
      expect(config.username).toBeUndefined();
      expect(config.syncStars).toBe(false);
    });
  });
});
