import { describe, it, expect } from 'vitest';
import { hasSubcommandArg } from '../../src/lib/cli-args.js';

describe('hasSubcommandArg', () => {
  it('returns false for empty or undefined args', () => {
    expect(hasSubcommandArg(undefined)).toBe(false);
    expect(hasSubcommandArg([])).toBe(false);
  });

  it('returns false when only flags are present', () => {
    expect(hasSubcommandArg(['--quiet'])).toBe(false);
    expect(hasSubcommandArg(['-q', '--verbose'])).toBe(false);
  });

  it('returns true when a subcommand is present', () => {
    expect(hasSubcommandArg(['rm'])).toBe(true);
    expect(hasSubcommandArg(['--quiet', 'rm'])).toBe(true);
    expect(hasSubcommandArg(['add', '--help'])).toBe(true);
  });
});
