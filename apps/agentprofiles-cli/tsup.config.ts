import { execSync } from 'node:child_process';
import { defineConfig } from 'tsup';

const isRelease = process.env.RELEASE === 'true';
const buildTime = isRelease ? '' : formatBuildTime(new Date());
const gitSha = isRelease ? '' : getGitSha();

function formatBuildTime(date: Date): string {
  const iso = date.toISOString();
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: true,
  noExternal: [/^(?!update-notifier).*/],
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __DEV__: isRelease ? 'false' : 'true',
    __BUILD_TIME__: JSON.stringify(buildTime),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
});
