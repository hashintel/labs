import { describe, it, expect } from 'vitest';
import { parseCliArgs } from './index.js';

describe('parseCliArgs', () => {
  it('parses sync command', () => {
    const args = parseCliArgs(['sync']);
    expect(args.command).toBe('sync');
  });

  it('parses install command', () => {
    const args = parseCliArgs(['install']);
    expect(args.command).toBe('install');
  });

  it('parses status command', () => {
    const args = parseCliArgs(['status']);
    expect(args.command).toBe('status');
  });

  it('parses detect command', () => {
    const args = parseCliArgs(['detect']);
    expect(args.command).toBe('detect');
  });

  it('returns null for unknown command', () => {
    const args = parseCliArgs(['unknown']);
    expect(args.command).toBe(null);
  });

  it('returns null for no command', () => {
    const args = parseCliArgs([]);
    expect(args.command).toBe(null);
  });

  it('parses --to flag with single value', () => {
    const args = parseCliArgs(['sync', '--to', 'cursor']);
    expect(args.to).toEqual(['cursor']);
  });

  it('parses --to flag with multiple values', () => {
    const args = parseCliArgs(['sync', '--to', 'cursor', '--to', 'windsurf']);
    expect(args.to).toEqual(['cursor', 'windsurf']);
  });

  it('parses --dry-run flag', () => {
    const args = parseCliArgs(['install', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('parses --sync-removals flag', () => {
    const args = parseCliArgs(['install', '--sync-removals']);
    expect(args.syncRemovals).toBe(true);
  });

  it('parses -h help flag', () => {
    const args = parseCliArgs(['-h']);
    expect(args.help).toBe(true);
  });

  it('parses --help flag', () => {
    const args = parseCliArgs(['--help']);
    expect(args.help).toBe(true);
  });

  it('parses --verbose flag', () => {
    const args = parseCliArgs(['sync', '--verbose']);
    expect(args.verbose).toBe(true);
  });

  it('parses -v verbose flag', () => {
    const args = parseCliArgs(['sync', '-v']);
    expect(args.verbose).toBe(true);
  });

  it('parses --sync-only flag', () => {
    const args = parseCliArgs(['sync', '--sync-only']);
    expect(args.syncOnly).toBe(true);
  });

  it('parses combined flags', () => {
    const args = parseCliArgs(['install', '--to', 'cursor', '--sync-removals', '--dry-run']);
    expect(args.command).toBe('install');
    expect(args.to).toEqual(['cursor']);
    expect(args.syncRemovals).toBe(true);
    expect(args.dryRun).toBe(true);
  });
});
