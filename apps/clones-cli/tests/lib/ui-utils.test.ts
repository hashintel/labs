import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toUserPath, formatRelativeTime, formatDate } from '../../src/lib/ui-utils.js';

describe('toUserPath', () => {
  const originalHome = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = '/Users/testuser';
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('replaces home directory with ~', () => {
    expect(toUserPath('/Users/testuser/code/project')).toBe('~/code/project');
  });

  it('handles exact home directory', () => {
    expect(toUserPath('/Users/testuser')).toBe('~');
  });

  it('leaves paths outside home unchanged', () => {
    expect(toUserPath('/tmp/project')).toBe('/tmp/project');
  });

  it("handles paths that start with home-like prefix but aren't home", () => {
    expect(toUserPath('/Users/testuser2/code')).toBe('/Users/testuser2/code');
  });

  it('handles undefined HOME gracefully', () => {
    delete process.env.HOME;
    expect(toUserPath('/Users/testuser/code')).toBe('/Users/testuser/code');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for times less than a minute ago", () => {
    const thirtySecondsAgo = new Date('2024-06-15T11:59:30Z').toISOString();
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('just now');
  });

  it('returns minutes ago for times less than an hour ago', () => {
    const fiveMinutesAgo = new Date('2024-06-15T11:55:00Z').toISOString();
    expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m ago');
  });

  it('returns hours ago for times less than a day ago', () => {
    const threeHoursAgo = new Date('2024-06-15T09:00:00Z').toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago for times less than 30 days ago', () => {
    const fiveDaysAgo = new Date('2024-06-10T12:00:00Z').toISOString();
    expect(formatRelativeTime(fiveDaysAgo)).toBe('5d ago');
  });

  it('returns formatted date for times more than 30 days ago', () => {
    const twoMonthsAgo = new Date('2024-04-01T12:00:00Z').toISOString();
    const result = formatRelativeTime(twoMonthsAgo);
    expect(result).toMatch(/Apr.*2024/);
  });
});

describe('formatDate', () => {
  it('formats date with time', () => {
    const isoString = '2024-06-15T14:30:00Z';
    const result = formatDate(isoString);
    // The exact format depends on locale, but should contain month, day, year, and time
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2024/);
  });
});
