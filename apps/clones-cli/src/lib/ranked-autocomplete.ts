import { AutocompletePrompt } from '@clack/core';
import type { Option } from '@clack/prompts';
import {
  S_BAR,
  S_CHECKBOX_SELECTED,
  S_CHECKBOX_INACTIVE,
  limitOptions,
  symbol,
  symbolBar,
} from '@clack/prompts';
import color from 'picocolors';

export interface RankedAutocompleteMultiSelectOptions<Value> {
  message: string;
  options: Option<Value>[];
  placeholder?: string;
  initialValues?: Value[];
  required?: boolean;
  maxItems?: number;
  /** Called on every keystroke with the search text.
   *  Return a Map<string, number> of option-identifier → BM25 score.
   *  Options in the map appear first, sorted by ascending score. */
  rankFn?: (searchText: string) => Map<string, number>;
  /** Map option value to its identifier for rankFn lookup.
   *  Defaults to using value directly if it's a string. */
  getOptionId?: (value: Value) => string;
  /** Optional custom metadata filter. Called with (searchText, option).
   *  Return true if the option matches on metadata (name, tags, description, etc.).
   *  If not provided, defaults to label/hint substring match. */
  metadataFilter?: (searchText: string, option: Option<Value>) => boolean;
}

export async function rankedAutocompleteMultiselect<Value>(
  opts: RankedAutocompleteMultiSelectOptions<Value>
): Promise<Value[] | symbol | undefined> {
  // Build a cache for rank results to avoid redundant calls
  const rankCache = new Map<string, Map<string, number>>();

  // Compute getOptionId once so both getOptions and filterFn use the same default
  const getOptionId = opts.getOptionId || ((v: Value) => String(v));

  // Create the options function that will be called on every keystroke
  // This MUST be a regular function (not arrow) so `this` is properly bound
  function getOptions(this: AutocompletePrompt<Option<Value>>): Option<Value>[] {
    const searchText = this.userInput;
    const allOptions = opts.options;

    // If no rankFn provided, return options in original order
    if (!opts.rankFn) {
      return allOptions;
    }

    // Get or compute ranks for this search text
    let ranks = rankCache.get(searchText);
    if (!ranks) {
      ranks = opts.rankFn(searchText);
      rankCache.set(searchText, ranks);
    }

    // Separate ranked and unranked options
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

    // Sort ranked options by score (ascending = better relevance)
    ranked.sort((a, b) => {
      const scoreA = ranks!.get(getOptionId(a.value)) ?? Infinity;
      const scoreB = ranks!.get(getOptionId(b.value)) ?? Infinity;
      return scoreA - scoreB;
    });

    // Return ranked first, then unranked in original order
    return [...ranked, ...unranked];
  }

  // Create a filter function that accepts ranked matches + metadata matches
  const filterFn = (searchText: string, option: Option<Value>): boolean => {
    if (!searchText) return true;

    // If this option was matched by FTS ranking, always include it
    if (opts.rankFn) {
      const lastRankMap = rankCache.get(searchText);
      if (lastRankMap) {
        const id = getOptionId(option.value);
        if (lastRankMap.has(id)) return true;
      }
    }

    // Otherwise, use metadataFilter if provided, or default to label/hint match
    if (opts.metadataFilter) {
      return opts.metadataFilter(searchText, option);
    }

    // Default: label or hint substring match
    const term = searchText.toLowerCase();
    const label = (option.label ?? String(option.value)).toLowerCase();
    const hint = (option.hint ?? '').toLowerCase();
    return label.includes(term) || hint.includes(term);
  };

  // Create the AutocompletePrompt with custom render
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

      // Helper to render a single option
      const renderOption = (option: Option<Value>, isFocused: boolean): string => {
        const isSelected = selectedValues.includes(option.value);
        const label = option.label ?? String(option.value);
        const hint = option.hint && isFocused ? color.dim(` (${option.hint})`) : '';
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
          return `${header}${bar}  ${color.dim(`${count} items selected`)}`;
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

          lines.push(`${barStr}  ${color.dim('Search:')} ${searchInput}${matchCount}`);

          if (filteredOptions.length === 0 && this.userInput) {
            lines.push(`${barStr}  ${color.yellow('No matches found')}`);
          }

          if (state === 'error') {
            lines.push(`${barStr}  ${color.yellow(this.error)}`);
          }

          // Render options with pagination
          const optionLines = limitOptions({
            cursor: this.cursor,
            options: filteredOptions,
            maxItems: opts.maxItems,
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
