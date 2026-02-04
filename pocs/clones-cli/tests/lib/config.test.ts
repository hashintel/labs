import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readFileSync = vi.fn();
const existsSync = vi.fn();

vi.mock('node:fs', () => ({
  readFileSync,
  existsSync,
}));

const { getSyncConcurrency } = await import('../../src/lib/config.js');

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
