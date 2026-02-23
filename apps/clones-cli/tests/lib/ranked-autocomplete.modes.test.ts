import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockPromptHandler = (...args: any[]) => void;

const promptResolvers: Array<(value: unknown) => void> = [];
const promptInstances: MockAutocompletePrompt[] = [];

class MockAutocompletePrompt {
  private handlers = new Map<string, MockPromptHandler[]>();
  private optionsSource: unknown;
  private renderSource: ((this: MockAutocompletePrompt) => string) | undefined;

  state = 'active';
  error = '';
  userInput = '';
  isNavigating = false;
  selectedValues: unknown[] = [];
  filteredOptions: unknown[] = [];
  focusedValue: unknown = undefined;
  cursor = 0;

  constructor(
    private readonly opts: { options: unknown; render?: (this: MockAutocompletePrompt) => string }
  ) {
    this.optionsSource = opts.options;
    this.renderSource = opts.render;
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

  renderFrame() {
    return this.renderSource?.call(this) ?? '';
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
const { limitOptions: mockLimitOptions } = await import('@clack/prompts');

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

  it('reserves viewport space so mode controls stay visible', async () => {
    const pending = rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'repo-a', label: 'repo-a' }],
      modes: [
        { id: 'metadata', label: 'Metadata' },
        { id: 'vector', label: 'Vector' },
      ],
    });

    const prompt = promptInstances[0];
    prompt.filteredOptions = prompt.options as unknown[];
    void prompt.renderFrame();

    expect(mockLimitOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        columnPadding: 3,
        rowPadding: 7,
      })
    );

    const cancelSymbol = Symbol('cancel');
    promptResolvers[0](cancelSymbol);

    const result = await pending;
    expect(result).toBe(cancelSymbol);
  });

  it('hard-caps focused hint text to avoid awkward wrapping', async () => {
    const limitOptionsSpy = mockLimitOptions as unknown as ReturnType<typeof vi.fn>;
    limitOptionsSpy.mockImplementation(({ options, style }: any) => [style(options[0], true)]);

    const longHint = 'h'.repeat(90);
    const pending = rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'repo-a', label: 'repo-a', hint: longHint }],
      modes: [{ id: 'metadata', label: 'Metadata' }],
    });

    const prompt = promptInstances[0];
    prompt.filteredOptions = prompt.options as unknown[];
    const frame = prompt.renderFrame();

    expect(frame).toContain(`(${`${'h'.repeat(69)}...`})`);
    expect(frame).not.toContain(`(${longHint})`);

    const cancelSymbol = Symbol('cancel');
    promptResolvers[0](cancelSymbol);

    const result = await pending;
    expect(result).toBe(cancelSymbol);
  });
});
