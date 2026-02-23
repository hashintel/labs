import { AutocompletePrompt } from '@clack/core';
import type { Option } from '@clack/prompts';
import type { Key } from 'node:readline';
import {
  S_BAR,
  S_CHECKBOX_SELECTED,
  S_CHECKBOX_INACTIVE,
  limitOptions,
  symbol,
  symbolBar,
} from '@clack/prompts';
import color from 'picocolors';

const OPTION_HINT_HARD_MAX_LENGTH = 72;

export interface RankedAutocompleteMode {
  id: string;
  label: string;
  hint?: string;
}

export interface RankedAutocompleteContext {
  mode: RankedAutocompleteMode;
  modeIndex: number;
  modeCount: number;
}

export interface RankedAutocompleteMultiSelectOptions<Value> {
  message: string;
  options: Option<Value>[];
  placeholder?: string;
  initialValues?: Value[];
  required?: boolean;
  maxItems?: number;
  modes?: RankedAutocompleteMode[];
  initialModeId?: string;
  /** Called on every keystroke with the search text.
   *  Return a Map<string, number> of option-identifier → BM25 score.
   *  Options in the map appear first, sorted by ascending score. */
  rankFn?: (searchText: string, context?: RankedAutocompleteContext) => Map<string, number>;
  /** Map option value to its identifier for rankFn lookup.
   *  Defaults to using value directly if it's a string. */
  getOptionId?: (value: Value) => string;
  /** Optional custom metadata filter. Called with (searchText, option).
   *  Return true if the option matches on metadata (name, tags, description, etc.).
   *  If not provided, defaults to label/hint substring match. */
  metadataFilter?: (
    searchText: string,
    option: Option<Value>,
    context?: RankedAutocompleteContext
  ) => boolean;
}

export async function rankedAutocompleteMultiselect<Value>(
  opts: RankedAutocompleteMultiSelectOptions<Value>
): Promise<Value[] | symbol | undefined> {
  const modes =
    opts.modes && opts.modes.length > 0 ? opts.modes : [{ id: 'default', label: 'All' }];
  const initialModeIndex = opts.initialModeId
    ? Math.max(
        0,
        modes.findIndex((mode) => mode.id === opts.initialModeId)
      )
    : 0;
  let activeModeIndex = initialModeIndex;

  const getModeContext = (): RankedAutocompleteContext => ({
    mode: modes[activeModeIndex],
    modeIndex: activeModeIndex,
    modeCount: modes.length,
  });

  const getRankCacheKey = (searchText: string): string =>
    `${getModeContext().mode.id}\u0000${searchText}`;

  const rankCache = new Map<string, Map<string, number>>();

  const getOptionId = opts.getOptionId || ((v: Value) => String(v));

  function getOptions(this: AutocompletePrompt<Option<Value>>): Option<Value>[] {
    const searchText = this.userInput;
    const allOptions = opts.options;

    if (!opts.rankFn) {
      return allOptions;
    }

    const cacheKey = getRankCacheKey(searchText);
    let ranks = rankCache.get(cacheKey);
    if (!ranks) {
      ranks = opts.rankFn(searchText, getModeContext());
      rankCache.set(cacheKey, ranks);
    }

    const ranked: Option<Value>[] = [];
    const unranked: Option<Value>[] = [];

    for (const option of allOptions) {
      const optionId = getOptionId(option.value);
      if (ranks.has(optionId)) {
        ranked.push(option);
      } else {
        unranked.push(option);
      }
    }

    ranked.sort((a, b) => {
      const scoreA = ranks!.get(getOptionId(a.value)) ?? Infinity;
      const scoreB = ranks!.get(getOptionId(b.value)) ?? Infinity;
      return scoreA - scoreB;
    });

    return [...ranked, ...unranked];
  }

  const filterFn = (searchText: string, option: Option<Value>): boolean => {
    if (!searchText) return true;

    if (opts.rankFn) {
      const lastRankMap = rankCache.get(getRankCacheKey(searchText));
      if (lastRankMap) {
        const id = getOptionId(option.value);
        if (lastRankMap.has(id)) return true;
      }
    }

    if (opts.metadataFilter) {
      return opts.metadataFilter(searchText, option, getModeContext());
    }

    const term = searchText.toLowerCase();
    const label = (option.label ?? String(option.value)).toLowerCase();
    const hint = (option.hint ?? '').toLowerCase();
    return label.includes(term) || hint.includes(term);
  };

  const prompt = new AutocompletePrompt<Option<Value>>({
    options: getOptions,
    filter: filterFn,
    multiple: true,
    initialValue: opts.initialValues,
    render(this: AutocompletePrompt<Option<Value>>) {
      const state = this.state;
      const selectedValues = this.selectedValues;
      const filteredOptions = this.filteredOptions;
      const allOptions = this.options;
      const activeMode = modes[activeModeIndex];

      const renderOption = (option: Option<Value>, isFocused: boolean): string => {
        const isSelected = selectedValues.includes(option.value);
        const label = option.label ?? String(option.value);
        const truncatedHint = option.hint
          ? truncateInline(option.hint, OPTION_HINT_HARD_MAX_LENGTH)
          : undefined;
        const hint = truncatedHint && isFocused ? color.dim(` (${truncatedHint})`) : '';
        const checkbox = isSelected
          ? color.green(S_CHECKBOX_SELECTED)
          : color.dim(S_CHECKBOX_INACTIVE);
        return isFocused ? `${checkbox} ${label}${hint}` : `${checkbox} ${color.dim(label)}${hint}`;
      };

      const bar = color.gray(S_BAR);
      const header = `${bar}\n${symbol(state)}  ${opts.message}\n`;

      switch (state) {
        case 'submit': {
          const count = selectedValues.length;
          return `${header}${bar}  ${color.dim(`${count} items selected (${activeMode.label})`)}`;
        }
        case 'cancel': {
          const input = this.userInput ? color.strikethrough(color.dim(this.userInput)) : '';
          return `${header}${bar}  ${input}`;
        }
        default: {
          const searchInput = this.isNavigating
            ? color.dim(this.userInput || opts.placeholder || '')
            : this.userInputWithCursor;
          const matchCount =
            filteredOptions.length !== allOptions.length
              ? color.dim(
                  ` (${filteredOptions.length} match${filteredOptions.length === 1 ? '' : 'es'})`
                )
              : '';

          const lines: string[] = [header];
          const barColor = state === 'error' ? color.yellow : color.cyan;
          const barStr = barColor(S_BAR);

          if (modes.length > 1) {
            const functionKeyModeMax = Math.min(modes.length, 12);
            const altDigitModeMax = Math.min(modes.length, 9);
            const modeTabs = modes
              .map((mode, index) =>
                index === activeModeIndex ? color.cyan(`[${mode.label}]`) : color.dim(mode.label)
              )
              .join(' ');
            const modeHint = activeMode.hint ? color.dim(` (${activeMode.hint})`) : '';
            lines.push(`${barStr}  ${color.dim('Mode:')} ${modeTabs}${modeHint}`);
            lines.push(
              `${barStr}  ${color.dim(
                `F1..${functionKeyModeMax} jump | Ctrl+P/N cycle | Alt+1..${altDigitModeMax} fallback`
              )}`
            );
          }

          lines.push(`${barStr}  ${color.dim('Search:')} ${searchInput}${matchCount}`);

          if (filteredOptions.length === 0 && this.userInput) {
            lines.push(`${barStr}  ${color.yellow('No matches found')}`);
          }

          if (state === 'error') {
            lines.push(`${barStr}  ${color.yellow(this.error)}`);
          }

          const headerRowCount = 3; // top guide + prompt message + spacer newline in header
          const modeRowCount = modes.length > 1 ? 2 : 0;
          const searchRowCount = 1;
          const noMatchRowCount = filteredOptions.length === 0 && this.userInput ? 1 : 0;
          const errorRowCount = state === 'error' ? 1 : 0;
          const footerRowCount = 1; // closing symbol bar
          const rowPadding =
            headerRowCount +
            modeRowCount +
            searchRowCount +
            noMatchRowCount +
            errorRowCount +
            footerRowCount;

          const optionLines = limitOptions({
            cursor: this.cursor,
            options: filteredOptions,
            maxItems: opts.maxItems,
            columnPadding: 3, // account for the rendered `${barStr}  ` prefix on every option line
            rowPadding,
            style: (option, isFocused) => renderOption(option, isFocused),
          });

          for (const line of optionLines) {
            lines.push(`${barStr}  ${line}`);
          }

          lines.push(`${barColor(symbolBar(state))}`);
          return lines.join('\n');
        }
      }
    },
  });

  if (modes.length > 1) {
    const refreshPrompt = () => {
      // Force an in-place refresh without changing visible query text.
      prompt.emit('userInput', `${prompt.userInput}\u0000`);
      prompt.emit('userInput', prompt.userInput);
    };

    prompt.on('key', (char, keyInfo) => {
      const modeJumpIndex = getModeJumpIndex(char, keyInfo, modes.length);
      if (modeJumpIndex !== null && modeJumpIndex !== activeModeIndex) {
        activeModeIndex = modeJumpIndex;
        rankCache.clear();
        refreshPrompt();
        return;
      }

      const direction = getModeSwitchDirection(keyInfo);
      if (direction === 0) {
        return;
      }

      activeModeIndex = (activeModeIndex + direction + modes.length) % modes.length;
      rankCache.clear();
      refreshPrompt();
    });
  }

  const result = await prompt.prompt();

  if (typeof result === 'symbol' || result === undefined) {
    return result as Value[] | symbol | undefined;
  }

  const selected = result as Value[];
  if (selected.length === 0 && prompt.focusedValue !== undefined) {
    return [prompt.focusedValue as Value];
  }

  return selected;
}

function getModeSwitchDirection(keyInfo: Key): -1 | 0 | 1 {
  if (keyInfo.ctrl && (keyInfo.name === 'p' || keyInfo.name === 'left')) {
    return -1;
  }

  if (keyInfo.ctrl && (keyInfo.name === 'n' || keyInfo.name === 'right')) {
    return 1;
  }

  return 0;
}

function getModeJumpIndex(
  char: string | undefined,
  keyInfo: Key,
  modeCount: number
): number | null {
  const functionKeyIndex = getFunctionKeyJumpIndex(keyInfo.name, modeCount);
  if (functionKeyIndex !== null) {
    return functionKeyIndex;
  }

  if (!keyInfo.meta) {
    return null;
  }

  const digit = char ?? keyInfo.name;
  if (!digit || !/^[1-9]$/.test(digit)) {
    return null;
  }

  const index = Number.parseInt(digit, 10) - 1;
  if (index < 0 || index >= modeCount) {
    return null;
  }

  return index;
}

function getFunctionKeyJumpIndex(keyName: string | undefined, modeCount: number): number | null {
  if (!keyName) {
    return null;
  }

  const match = /^f([1-9]|1[0-2])$/.exec(keyName);
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[1], 10) - 1;
  if (index < 0 || index >= modeCount) {
    return null;
  }

  return index;
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 3) {
    return '.'.repeat(Math.max(maxLength, 0));
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
