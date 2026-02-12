export function createPool(concurrency: number) {
  const queue: Array<() => Promise<void>> = [];
  let running = 0;

  async function runNext(): Promise<void> {
    if (running >= concurrency || queue.length === 0) {
      return;
    }

    const task = queue.shift()!;
    running++;

    try {
      await task();
    } finally {
      running--;
      runNext();
    }
  }

  function add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      runNext();
    });
  }

  async function drain(): Promise<void> {
    while (running > 0 || queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  return { add, drain };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const pool = createPool(concurrency);

  const promises = items.map((item, index) =>
    pool.add(async () => {
      results[index] = await fn(item);
    })
  );

  await Promise.all(promises);
  return results;
}
