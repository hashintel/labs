import { defineCommand } from 'citty';
import * as p from '@clack/prompts';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getRegistryPath, getLocalStatePath, ensureConfigDir } from '../lib/config.js';
import {
  createEmptyRegistry,
  parseRegistryContent,
  readRegistryFile,
  readRegistry,
  stringifyRegistry,
  writeRegistry,
} from '../lib/registry.js';
import { createEmptyLocalState, writeLocalState } from '../lib/local-state.js';
import { normalizeRegistry, normalizeLocalState } from '../lib/schema.js';
import { openDb, closeDb } from '../lib/db.js';
import { syncRegistryToDb } from '../lib/db-sync.js';

async function readJsonFile(path: string, label: string): Promise<unknown> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} is corrupted: ${path}`);
    }
    throw error;
  }
}

async function doctorRegistry(): Promise<void> {
  const registryPath = getRegistryPath();
  const registryFile = await readRegistryFile();
  if (!registryFile) {
    await writeRegistry(createEmptyRegistry());
    p.log.warn(`Created missing registry file: ${registryPath}`);
    return;
  }

  let raw: unknown;
  try {
    raw = parseRegistryContent(registryFile.content, registryFile.format, registryFile.path);
  } catch {
    p.log.error(`Registry file is corrupted: ${registryPath}`);
    const shouldReset = await p.confirm({
      message: 'Reset to empty registry? (existing entries will be lost)',
      initialValue: false,
    });
    if (p.isCancel(shouldReset) || !shouldReset) {
      throw new Error('Registry corruption not resolved');
    }
    await writeRegistry(createEmptyRegistry());
    p.log.success(`Reset registry: ${registryPath}`);
    return;
  }

  const normalized = normalizeRegistry(raw);
  const canonical = stringifyRegistry(normalized.data);
  const needsWrite = registryFile.format !== 'jsonl' || canonical !== registryFile.content;

  if (needsWrite) {
    await writeRegistry(normalized.data);
    p.log.success(`Normalized registry: ${registryPath}`);
  } else {
    p.log.info(`Registry OK: ${registryPath}`);
  }

  for (const issue of normalized.issues) {
    p.log.warn(`  - ${issue}`);
  }
}

async function doctorLocalState(): Promise<void> {
  const path = getLocalStatePath();

  if (!existsSync(path)) {
    await writeLocalState(createEmptyLocalState());
    p.log.warn(`Created missing local state file: ${path}`);
    return;
  }

  const raw = await readJsonFile(path, 'Local state');
  const normalized = normalizeLocalState(raw);
  const rawNormalized = JSON.stringify(raw, null, 2);
  const canonical = JSON.stringify(normalized.data, null, 2);

  if (canonical !== rawNormalized) {
    await writeLocalState(normalized.data);
    p.log.success(`Normalized local state: ${path}`);
  } else {
    p.log.info(`Local state OK: ${path}`);
  }

  for (const issue of normalized.issues) {
    p.log.warn(`  - ${issue}`);
  }
}

async function syncRegistrySnapshotToDb(): Promise<void> {
  try {
    const db = await openDb();
    const registry = await readRegistry();
    syncRegistryToDb(db, registry);
  } catch (error) {
    p.log.warn(
      `Local index database was not updated: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    closeDb();
  }
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Normalize and validate registry/local state files',
  },
  async run() {
    p.intro('clones doctor');

    try {
      await ensureConfigDir();
      await doctorRegistry();
      await doctorLocalState();
      await syncRegistrySnapshotToDb();
      p.outro('Done!');
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
