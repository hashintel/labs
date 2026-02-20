import { describe, it, expect } from 'vitest';
import { execa } from 'execa';

describe('agentprofiles CLI', () => {
  it('should show help', async () => {
    const { stdout } = await execa('npx', ['tsx', 'src/index.ts', '--help']);
    expect(stdout).toContain('Manage configuration profiles for LLM agent tools');
    expect(stdout).toContain('setup');
    expect(stdout).toContain('list');
    expect(stdout).toContain('add');
    expect(stdout).toContain('set');
    expect(stdout).toContain('status');
    expect(stdout).toContain('release');
  });

  it('should show version', async () => {
    const { stdout } = await execa('npx', ['tsx', 'src/index.ts', '--version']);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
