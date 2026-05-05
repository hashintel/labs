import { describe, expect, it } from 'vitest';
import { normalizeConcurrency, runWithConcurrency } from '../../src/lib/concurrency.js';

describe('normalizeConcurrency', () => {
  it('defaults when input is missing', () => {
    const result = normalizeConcurrency(undefined);
    expect(result.value).toBe(4);
    expect(result.warning).toBeUndefined();
  });

  it('uses default with warning for invalid input', () => {
    const result = normalizeConcurrency('nope');
    expect(result.value).toBe(4);
    expect(result.warning).toContain('Invalid concurrency');
  });

  it('caps at max', () => {
    const result = normalizeConcurrency(99);
    expect(result.value).toBe(10);
    expect(result.warning).toContain('capped');
  });

  it('rounds down non-integers with warning', () => {
    const result = normalizeConcurrency(3.7);
    expect(result.value).toBe(3);
    expect(result.warning).toContain('integer');
  });

  it('falls back to default for non-positive values', () => {
    const result = normalizeConcurrency(0);
    expect(result.value).toBe(4);
    expect(result.warning).toContain('Concurrency must be');
  });

  it('respects custom defaults', () => {
    const result = normalizeConcurrency(undefined, { defaultValue: 2, max: 5, min: 1 });
    expect(result.value).toBe(2);
  });
});

describe('runWithConcurrency', () => {
  it('limits the number of concurrent tasks', async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;

    const results: number[] = [];
    for await (const value of runWithConcurrency(items, 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return item;
    })) {
      results.push(value);
    }

    expect(results.sort((a, b) => a - b)).toEqual(items);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
