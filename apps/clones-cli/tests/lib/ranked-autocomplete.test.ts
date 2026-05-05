import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrompt = vi.fn();
const mockFocusedValue = { current: undefined as unknown };

vi.mock('@clack/core', () => ({
  AutocompletePrompt: class {
    prompt = mockPrompt;
    get focusedValue() {
      return mockFocusedValue.current;
    }
  },
}));

vi.mock('@clack/prompts', () => ({
  S_BAR: '│',
  S_CHECKBOX_SELECTED: '◻',
  S_CHECKBOX_INACTIVE: '◻',
  limitOptions: vi.fn(() => []),
  symbol: vi.fn(() => '◆'),
  symbolBar: vi.fn(() => '│'),
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

describe('rankedAutocompleteMultiselect implicit single selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFocusedValue.current = undefined;
  });

  it('returns focusedValue as single-item array when selection is empty', async () => {
    mockPrompt.mockResolvedValue([]);
    mockFocusedValue.current = 'focused-item';

    const result = await rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'focused-item', label: 'Focused' }],
    });

    expect(result).toEqual(['focused-item']);
  });

  it('returns non-empty selection unchanged', async () => {
    mockPrompt.mockResolvedValue(['a', 'b']);
    mockFocusedValue.current = 'a';

    const result = await rankedAutocompleteMultiselect({
      message: 'test',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });

    expect(result).toEqual(['a', 'b']);
  });

  it('returns cancel symbol unchanged', async () => {
    const cancelSymbol = Symbol('cancel');
    mockPrompt.mockResolvedValue(cancelSymbol);

    const result = await rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'a', label: 'A' }],
    });

    expect(result).toBe(cancelSymbol);
  });

  it('returns undefined unchanged', async () => {
    mockPrompt.mockResolvedValue(undefined);

    const result = await rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'a', label: 'A' }],
    });

    expect(result).toBeUndefined();
  });

  it('returns empty array when selection is empty and focusedValue is undefined', async () => {
    mockPrompt.mockResolvedValue([]);
    mockFocusedValue.current = undefined;

    const result = await rankedAutocompleteMultiselect({
      message: 'test',
      options: [{ value: 'a', label: 'A' }],
    });

    expect(result).toEqual([]);
  });
});
