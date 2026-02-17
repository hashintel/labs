/**
 * Batch operations for multiple repository selections
 */

import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import { toUserPath, copyToClipboard } from '../ui-utils.js';
import { readRegistry, writeRegistry, updateEntry } from '../registry.js';
import type { RegistryEntry, RepoStatus } from '../../types/index.js';
import { ExitRequestedError } from './errors.js';

/**
 * Repository info with status - shared type for browse operations
 */
export interface RepoInfo {
  entry: RegistryEntry;
  status: RepoStatus;
  localPath: string;
}

/**
 * Format multiple paths for clipboard (newline-separated, with ~ for home)
 */
export function formatPathsForClipboard(repos: RepoInfo[]): string {
  return repos.map((r) => toUserPath(r.localPath)).join('\n');
}

/**
 * Format multiple remote URLs for clipboard (newline-separated)
 */
export function formatUrlsForClipboard(repos: RepoInfo[]): string {
  return repos.map((r) => r.entry.cloneUrl).join('\n');
}

/**
 * Format repos as JSON array
 */
export function formatAsJson(repos: RepoInfo[]): string {
  const data = repos.map((r) => ({
    ownerRepo: `${r.entry.owner}/${r.entry.repo}`,
    path: toUserPath(r.localPath),
    description: r.entry.description ?? null,
    tags: r.entry.tags ?? [],
    cloneUrl: r.entry.cloneUrl,
  }));
  return JSON.stringify(data, null, 2);
}

/**
 * Format repos as markdown list
 */
export function formatAsMarkdownList(repos: RepoInfo[]): string {
  return repos.map((r) => `- ${r.entry.owner}/${r.entry.repo}`).join('\n');
}

/**
 * Format repos as markdown table with aligned columns
 */
export function formatAsMarkdownTable(repos: RepoInfo[]): string {
  const headers = ['Repository', 'Path', 'Description'];
  const rows = repos.map((r) => [
    `${r.entry.owner}/${r.entry.repo}`,
    toUserPath(r.localPath),
    r.entry.description ?? '',
  ]);

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));

  const pad = (s: string, w: number) => s + ' '.repeat(w - s.length);

  const headerRow = '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |';
  const separatorRow = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const dataRows = rows.map(
    (row) => '| ' + row.map((cell, i) => pad(cell, colWidths[i])).join(' | ') + ' |'
  );

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

/**
 * Open repos in VS Code editor
 */
function openInEditor(repos: RepoInfo[]): void {
  for (const repo of repos) {
    spawn('code', [repo.localPath], { detached: true, stdio: 'ignore' }).unref();
  }
}

/**
 * Display summary of selected repositories
 */
export function showReposSummary(repos: RepoInfo[]): void {
  console.log();
  console.log(`  Selected ${repos.length} repositories:`);
  console.log(`  ${'─'.repeat(40)}`);

  for (const repo of repos) {
    const shortPath = toUserPath(repo.localPath);
    const statusIcon = !repo.status.exists ? '✗' : repo.status.isDirty ? '●' : '✓';
    console.log(`  ${statusIcon} ${repo.entry.owner}/${repo.entry.repo}`);
    console.log(`     ${shortPath}`);
  }

  console.log();
}

/**
 * Batch edit tags for multiple repositories
 * Options: add tags to all, remove tags from all, or replace tags on all
 */
async function _batchEditTags(repos: RepoInfo[]): Promise<void> {
  const action = await p.select({
    message: `Edit tags for ${repos.length} repositories`,
    options: [
      { value: 'add', label: 'Add tags to all', hint: 'append to existing' },
      { value: 'remove', label: 'Remove tags from all', hint: 'remove if present' },
      { value: 'replace', label: 'Replace tags on all', hint: 'overwrite existing' },
      { value: 'back', label: 'Back' },
    ],
  });

  if (p.isCancel(action) || action === 'back') {
    return;
  }

  const tagsInput = await p.text({
    message:
      action === 'remove'
        ? 'Enter tags to remove (comma-separated)'
        : 'Enter tags (comma-separated)',
    placeholder: 'cli, typescript, framework',
  });

  if (p.isCancel(tagsInput) || !tagsInput) {
    return;
  }

  const inputTags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (inputTags.length === 0) {
    p.log.warn('No tags provided');
    return;
  }

  let registry = await readRegistry();

  for (const repo of repos) {
    const currentTags = repo.entry.tags ?? [];
    let newTags: string[];

    switch (action) {
      case 'add':
        // Add new tags, avoiding duplicates
        newTags = [...new Set([...currentTags, ...inputTags])];
        break;
      case 'remove':
        // Remove specified tags
        newTags = currentTags.filter((t) => !inputTags.includes(t));
        break;
      case 'replace':
        // Replace all tags
        newTags = inputTags;
        break;
      default:
        newTags = currentTags;
    }

    registry = updateEntry(registry, repo.entry.id, {
      tags: newTags.length > 0 ? newTags : undefined,
    });
  }

  await writeRegistry(registry);

  const verb = action === 'add' ? 'Added' : action === 'remove' ? 'Removed' : 'Set';
  p.log.success(`${verb} tags for ${repos.length} repositories`);
}

/**
 * Show batch actions menu for multiple selected repositories
 */
export async function showBatchActions(repos: RepoInfo[]): Promise<void> {
  showReposSummary(repos);

  const action = await p.select({
    message: `Batch actions for ${repos.length} repositories`,
    options: [
      { value: 'copy-paths', label: 'Copy as path strings', hint: 'newline-separated with ~' },
      { value: 'copy-urls', label: 'Copy as remote URLs', hint: 'newline-separated' },
      { value: 'copy-json', label: 'Copy as JSON', hint: 'array of objects' },
      { value: 'copy-md-list', label: 'Copy as markdown list', hint: '- owner/repo' },
      { value: 'copy-md-table', label: 'Copy as markdown table', hint: '| repo | path | desc |' },
      { value: 'open-editor', label: 'Open in editor', hint: 'spawn code for each' },
      { value: 'browse', label: 'Browse again' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'browse') {
    return;
  }

  if (action === 'exit') {
    throw new ExitRequestedError();
  }

  switch (action) {
    case 'copy-paths': {
      const pathsText = formatPathsForClipboard(repos);
      await copyToClipboard(pathsText);
      p.log.success(`Copied ${repos.length} paths to clipboard`);
      break;
    }

    case 'copy-urls': {
      const urlsText = formatUrlsForClipboard(repos);
      await copyToClipboard(urlsText);
      p.log.success(`Copied ${repos.length} URLs to clipboard`);
      break;
    }

    case 'copy-json': {
      const jsonText = formatAsJson(repos);
      await copyToClipboard(jsonText);
      p.log.success(`Copied ${repos.length} repos as JSON to clipboard`);
      break;
    }

    case 'copy-md-list': {
      const mdList = formatAsMarkdownList(repos);
      await copyToClipboard(mdList);
      p.log.success(`Copied ${repos.length} repos as markdown list to clipboard`);
      break;
    }

    case 'copy-md-table': {
      const mdTable = formatAsMarkdownTable(repos);
      await copyToClipboard(mdTable);
      p.log.success(`Copied ${repos.length} repos as markdown table to clipboard`);
      break;
    }

    case 'open-editor': {
      openInEditor(repos);
      p.log.success(`Opened ${repos.length} repos in VS Code`);
      break;
    }
  }

  throw new ExitRequestedError();
}
