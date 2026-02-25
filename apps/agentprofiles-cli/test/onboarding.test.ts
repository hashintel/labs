import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { expandTildePath } from '../src/lib/onboarding.js';

describe('expandTildePath (agentprofiles)', () => {
  it('expands "~" to the home directory', () => {
    expect(expandTildePath('~')).toBe(os.homedir());
  });

  it('expands "~/" paths relative to the home directory without dropping it', () => {
    const result = expandTildePath('~/.config/agentprofiles');
    expect(result).toBe(path.join(os.homedir(), '.config/agentprofiles'));
  });

  it('leaves non-tilde paths unchanged', () => {
    const absolute = '/var/tmp/foo';
    const withTildeInside = '/tmp/~/foo';

    expect(expandTildePath(absolute)).toBe(absolute);
    expect(expandTildePath(withTildeInside)).toBe(withTildeInside);
  });
});
