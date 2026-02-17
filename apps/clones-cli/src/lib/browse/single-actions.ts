import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import { readLocalState, getLastSyncedAt } from '../local-state.js';
import { formatRelativeTime, toUserPath, copyToClipboard } from '../ui-utils.js';
import type { RepoInfo } from './batch-actions.js';

export type SingleActionContext = 'browse' | 'add';
export type SingleActionResult = 'exit' | 'browse' | 'add-another';

async function renderRepoDetails(repo: RepoInfo): Promise<void> {
  console.log();
  console.log(`  ${repo.entry.owner}/${repo.entry.repo}`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Path: ${toUserPath(repo.localPath)}`);
  console.log(`  URL:  ${repo.entry.cloneUrl}`);

  if (repo.entry.tags && repo.entry.tags.length > 0) {
    console.log(`  Tags: ${repo.entry.tags.join(', ')}`);
  } else {
    console.log(`  Tags: (none)`);
  }

  if (repo.entry.description) {
    console.log(`  Desc: ${repo.entry.description}`);
  } else {
    console.log(`  Desc: (none)`);
  }

  if (!repo.status.exists) {
    console.log(`  Status: ✗ Missing`);
  } else if (!repo.status.isGitRepo) {
    console.log(`  Status: ✗ Not a git repo`);
  } else if (repo.status.isDirty) {
    console.log(`  Status: ● Dirty`);
  } else {
    console.log(`  Status: ✓ Clean`);
  }

  const localState = await readLocalState();
  const lastSyncedAt = getLastSyncedAt(localState, repo.entry.id);
  if (lastSyncedAt) {
    console.log(`  Synced: ${formatRelativeTime(lastSyncedAt)}`);
  }

  console.log();
}

export async function showSingleRepoActions(
  repo: RepoInfo,
  context: SingleActionContext
): Promise<SingleActionResult> {
  await renderRepoDetails(repo);

  const options = [
    { value: 'copy', label: 'Copy path to clipboard' },
    { value: 'open', label: 'Open in editor' },
  ];

  if (context === 'browse') {
    options.push({ value: 'browse', label: 'Browse again' });
  } else {
    options.push({ value: 'add-another', label: 'Add another' });
  }

  options.push({ value: 'exit', label: 'Exit' });

  const action = await p.select({
    message: 'What would you like to do?',
    options,
  });

  if (p.isCancel(action) || action === 'exit') {
    return 'exit';
  }

  if (action === 'browse') {
    return 'browse';
  }

  if (action === 'add-another') {
    return 'add-another';
  }

  if (action === 'copy') {
    const userPath = toUserPath(repo.localPath);
    await copyToClipboard(userPath);
    p.log.success(`Copied: ${userPath}`);
    return 'exit';
  }

  if (action === 'open') {
    const editor = process.env.EDITOR || 'code';
    spawn(editor, [repo.localPath], { detached: true, stdio: 'ignore' }).unref();
    p.log.success(`Opened in ${editor}`);
    return 'exit';
  }

  return 'exit';
}
