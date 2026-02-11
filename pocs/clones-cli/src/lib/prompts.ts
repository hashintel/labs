/**
 * Mockable prompt re-exports
 *
 * This module re-exports prompt functions with the same interface,
 * allowing tests to mock interactive prompts without touching @clack internals.
 *
 * Usage in tests:
 *   import * as prompts from "../lib/prompts.js";
 *   vi.spyOn(prompts, "autocompleteMultiselect").mockResolvedValue([mockRepo]);
 */

import * as p from '@clack/prompts';
export { rankedAutocompleteMultiselect } from './ranked-autocomplete.js';
export type { RankedAutocompleteMultiSelectOptions } from './ranked-autocomplete.js';

export type { AutocompleteMultiSelectOptions, Option } from '@clack/prompts';

export const autocompleteMultiselect = p.autocompleteMultiselect;
export const isCancel = p.isCancel;
export const select = p.select;
export const text = p.text;
export const confirm = p.confirm;
export const spinner = p.spinner;
export const intro = p.intro;
export const outro = p.outro;
export const log = p.log;
export const cancel = p.cancel;
