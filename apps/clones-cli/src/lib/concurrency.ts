type NormalizeOptions = {
  defaultValue?: number;
  min?: number;
  max?: number;
};

type NormalizeResult = {
  value: number;
  warning?: string;
};

export function normalizeConcurrency(
  input: unknown,
  options: NormalizeOptions = {}
): NormalizeResult {
  const defaultValue = options.defaultValue ?? 4;
  const min = options.min ?? 1;
  const max = options.max ?? 10;

  if (input === undefined || input === null || input === '') {
    return { value: defaultValue };
  }

  const raw = typeof input === 'number' ? input : Number.parseInt(String(input), 10);
  if (!Number.isFinite(raw)) {
    return {
      value: defaultValue,
      warning: `Invalid concurrency "${String(input)}"; using ${defaultValue}.`,
    };
  }

  if (raw <= 0) {
    return {
      value: defaultValue,
      warning: `Concurrency must be >= ${min}; using ${defaultValue}.`,
    };
  }

  const rounded = Math.floor(raw);
  if (rounded > max) {
    return {
      value: max,
      warning: `Concurrency capped at ${max}.`,
    };
  }

  if (rounded < min) {
    return {
      value: min,
      warning: `Concurrency must be >= ${min}; using ${min}.`,
    };
  }

  if (rounded !== raw) {
    return {
      value: rounded,
      warning: `Concurrency must be an integer; using ${rounded}.`,
    };
  }

  return { value: rounded };
}

export async function* runWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>,
  signal?: AbortSignal
): AsyncGenerator<TResult, void, void> {
  const limit = Math.max(1, concurrency);
  const inFlight = new Set<Promise<TResult>>();
  let nextIndex = 0;
  let cancelled = false;

  const onAbort = () => {
    cancelled = true;
  };

  if (signal) {
    if (signal.aborted) {
      return;
    }
    signal.addEventListener('abort', onAbort);
  }

  const startNext = () => {
    if (cancelled || nextIndex >= items.length) return;
    const item = items[nextIndex];
    nextIndex += 1;

    const task = worker(item);
    task.finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  try {
    while (!cancelled && inFlight.size < limit && nextIndex < items.length) {
      startNext();
    }

    while (inFlight.size > 0) {
      const result = await Promise.race(inFlight);
      yield result;

      while (!cancelled && inFlight.size < limit && nextIndex < items.length) {
        startNext();
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
