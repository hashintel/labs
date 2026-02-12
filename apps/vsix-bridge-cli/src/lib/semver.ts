import * as semver from 'semver';

export function parseVersion(version: string): semver.SemVer | null {
  return semver.parse(version);
}

export function satisfiesEngineSpec(engineVersion: string, engineSpec: string): boolean {
  if (engineSpec === '*') {
    return true;
  }
  try {
    return semver.satisfies(engineVersion, engineSpec);
  } catch {
    return false;
  }
}

export function compareVersions(a: string, b: string): number {
  const parsedA = semver.parse(a);
  const parsedB = semver.parse(b);
  if (!parsedA && !parsedB) {
    return a.localeCompare(b);
  }
  if (!parsedA) return -1;
  if (!parsedB) return 1;
  return semver.compare(parsedA, parsedB);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
