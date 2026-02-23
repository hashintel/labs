import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockPromptHandler = (...args: any[]) => void;

const promptResolvers: Array<(value: unknown) => void> = [];
const promptInstances: MockAutocompletePrompt[] = [];

class MockAutocompletePrompt {
  private handlers = new Map<string, MockPromptHandler[]>();
  private optionsSource: unknown;

  state = 'active';
  error = '';
  userInput = '';
  isNavigating = false;
  selectedValues: unknown[] = [];
  filteredOptions: unknown[] = [];
  focusedValue: unknown = undefined;
  cursor = 0;

  constructor(private readonly opts: { options: unknown }) {
    this.optionsSource = opts.options;
    promptInstances.push(this);
  }

  get options() {
    return typeof this.optionsSource === 'function'
      ? (this.optionsSource as Function).call(this)
      : this.optionsSource;
  }

  get userInputWithCursor() {
    return this.userInput;
  }

  on(event: string, cb: MockPromptHandler) {
    const existing = this.handlers.get(event) ?? [];
    existing.push(cb);
    this.handlers.set(event, existing);
  }

  emit(event: string, ...args: unknown[]) {
    const listeners = this.handlers.get(event) ?? [];
    for (const listener of listeners) {
      listener(...args);
    }
  }

  prompt() {
    return new Promise((resolve) => {
      promptResolvers.push(resolve);
    });
  }
}

vi.mock('@clack/core', () => ({
  AutocompletePrompt: MockAutocompletePrompt,
}));

vi.mock('@clack/prompts', () => ({
  S_BAR: '|',
  S_CHECKBOX_SELECTED: '[x]',
  S_CHECKBOX_INACTIVE: '[ ]',
  limitOptions: vi.fn(() => []),
  symbol: vi.fn(() => '◆'),
  symbolBar: vi.fn(() => '|'),
}));

vi.mock('picocolors', () => ({
  default: {
    green: (s: string) => s,
    dim: (s: string) => s,
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    strikethrough: (s: string) => s,
  },
}));

const { rankedAutocompleteMultiselect } = await import('../../src/lib/ranked-autocomplete.js');

describe('rankedAutocompleteMultiselect mode switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    promptResolvers.length = 0;
    promptInstances.length = 0;
  });

  it('keeps query live and switches ranking context with Ctrl+P/N and Ctrl+Left/Right fallback', async () => {
    const rankFn = vi.fn(() => new Map<string, number>());

    const pending = rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'repo-a', label: 'repo-a' }],
      modes: [
        { id: 'metadata', label: 'Metadata' },
        { id: 'vector', label: 'Vector' },
      ],
      rankFn,
    });

    const prompt = promptInstances[0];
    prompt.userInput = 'prompt toolkit';

    void prompt.options;
    expect(rankFn).toHaveBeenLastCalledWith(
      'prompt toolkit',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'metadata' }) })
    );

    prompt.emit('key', undefined, { name: 'n', ctrl: true } as any);
    void prompt.options;

    expect(rankFn).toHaveBeenLastCalledWith(
      'prompt toolkit',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'vector' }) })
    );

    prompt.emit('key', undefined, { name: 'left', ctrl: true } as any);
    void prompt.options;

    expect(rankFn).toHaveBeenLastCalledWith(
      'prompt toolkit',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'metadata' }) })
    );

    const cancelSymbol = Symbol('cancel');
    promptResolvers[0](cancelSymbol);

    const result = await pending;
    expect(result).toBe(cancelSymbol);
  });

  it('supports direct mode jumps with function keys', async () => {
    const rankFn = vi.fn(() => new Map<string, number>());

    const pending = rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'repo-a', label: 'repo-a' }],
      modes: [
        { id: 'metadata', label: 'Metadata' },
        { id: 'bm25', label: 'BM25' },
        { id: 'vector', label: 'Vector' },
      ],
      rankFn,
    });

    const prompt = promptInstances[0];
    prompt.userInput = 'terminal';

    void prompt.options;
    expect(rankFn).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'metadata' }) })
    );

    prompt.emit('key', undefined, { name: 'f3' } as any);
    void prompt.options;

    expect(rankFn).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'vector' }) })
    );

    const cancelSymbol = Symbol('cancel');
    promptResolvers[0](cancelSymbol);

    const result = await pending;
    expect(result).toBe(cancelSymbol);
  });

  it('supports direct mode jumps with Alt+number', async () => {
    const rankFn = vi.fn(() => new Map<string, number>());

    const pending = rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'repo-a', label: 'repo-a' }],
      modes: [
        { id: 'metadata', label: 'Metadata' },
        { id: 'bm25', label: 'BM25' },
        { id: 'vector', label: 'Vector' },
      ],
      rankFn,
    });

    const prompt = promptInstances[0];
    prompt.userInput = 'terminal';

    void prompt.options;
    expect(rankFn).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'metadata' }) })
    );

    prompt.emit('key', '3', { name: '3', meta: true } as any);
    void prompt.options;

    expect(rankFn).toHaveBeenLastCalledWith(
      'terminal',
      expect.objectContaining({ mode: expect.objectContaining({ id: 'vector' }) })
    );

    const cancelSymbol = Symbol('cancel');
    promptResolvers[0](cancelSymbol);

    const result = await pending;
    expect(result).toBe(cancelSymbol);
  });
});
