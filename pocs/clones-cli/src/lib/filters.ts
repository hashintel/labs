/**
 * Reusable filter factories for autocomplete/search components
 */

import type { Option } from '@clack/prompts';
import type { RegistryEntry } from '../types/index.js';

export type FilterFn<Value> = (searchText: string, option: Option<Value>) => boolean;

/**
 * Create a filter function for repository entries
 * Searches across owner/repo name, tags, and description
 */
export function createRepoFilter(): FilterFn<RegistryEntry> {
  return (searchText: string, option: Option<RegistryEntry>): boolean => {
    if (!searchText) return true;

    const term = searchText.toLowerCase();
    const entry = option.value;
    const label = `${entry.owner}/${entry.repo}`.toLowerCase();
    const tags = entry.tags?.join(' ').toLowerCase() ?? '';
    const desc = entry.description?.toLowerCase() ?? '';

    return label.includes(term) || tags.includes(term) || desc.includes(term);
  };
}
