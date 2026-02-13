import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('concurrency', () => {
  describe('mapWithConcurrency', () => {
    it('processes all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await mapWithConcurrency(items, async (n) => n * 2, 2);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('preserves order', async () => {
      const items = [100, 50, 10];
      const results = await mapWithConcurrency(
        items,
        async (delay) => {
          await new Promise((r) => setTimeout(r, delay));
          return delay;
        },
        3
      );
      expect(results).toEqual([100, 50, 10]);
    });

    it('limits concurrency', async () => {
      let maxConcurrent = 0;
      let current = 0;

      const items = [1, 2, 3, 4, 5, 6];
      await mapWithConcurrency(
        items,
        async () => {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await new Promise((r) => setTimeout(r, 20));
          current--;
        },
        2
      );

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('handles empty array', async () => {
      const results = await mapWithConcurrency([], async (n: number) => n, 5);
      expect(results).toEqual([]);
    });

    it('handles errors', async () => {
      const items = [1, 2, 3];
      await expect(
        mapWithConcurrency(
          items,
          async (n) => {
            if (n === 2) throw new Error('fail');
            return n;
          },
          2
        )
      ).rejects.toThrow('fail');
    });

    it('clamps concurrency to at least 1', async () => {
      const items = [1, 2];
      const results = await mapWithConcurrency(items, async (n) => n, 0);
      expect(results).toEqual([1, 2]);
    });
  });
});
