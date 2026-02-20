import { describe, it, expect } from 'vitest';
import { createCancellationController } from '../../src/lib/cancel.js';
import { runWithConcurrency } from '../../src/lib/concurrency.js';

describe('createCancellationController', () => {
  it('aborts when cancel is called', () => {
    const controller = createCancellationController();
    expect(controller.signal.aborted).toBe(false);
    controller.cancel();
    expect(controller.signal.aborted).toBe(true);
    controller.dispose();
  });
});

describe('runWithConcurrency with signal', () => {
  it('stops scheduling new tasks after abort', async () => {
    const controller = new AbortController();
    const items = [0, 1, 2, 3];
    const started: number[] = [];
    const results: number[] = [];

    for await (const result of runWithConcurrency(
      items,
      2,
      async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item;
      },
      controller.signal
    )) {
      results.push(result);
      if (results.length === 1) {
        controller.abort();
      }
    }

    expect(started.length).toBeLessThanOrEqual(2);
  });
});
