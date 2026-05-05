/**
 * Legacy TOML registry parser.
 * Only needed for one-time migration from registry.toml to registry.jsonl.
 * TODO: Remove after sufficient adoption of JSONL format.
 */

function stripTomlComment(line: string): string {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && char === '#') {
      return line.slice(0, i);
    }
  }

  return line;
}

function parseTomlValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed);
  }
  if (trimmed.startsWith('[')) {
    if (!trimmed.endsWith(']')) {
      throw new Error('Invalid TOML array');
    }
    const inner = trimmed.slice(1, -1).replace(/,\s*$/, '');
    return JSON.parse(`[${inner}]`);
  }
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed === 'true';
  }

  throw new Error('Unsupported TOML value');
}

// Minimal TOML subset parser for registry.toml (strings, string arrays, booleans, [[repos]]).
export function parseRegistryToml(content: string): unknown {
  const result: Record<string, unknown> = {};
  const repos: Record<string, unknown>[] = [];
  let currentRepo: Record<string, unknown> | null = null;

  for (const rawLine of content.split('\n')) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    if (line === '[[repos]]') {
      currentRepo = {};
      repos.push(currentRepo);
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      throw new Error('Invalid TOML line');
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = parseTomlValue(line.slice(equalsIndex + 1));

    const isTopLevelKey = key === 'version' || key === 'tombstones';
    if (currentRepo && !isTopLevelKey) {
      currentRepo[key] = value;
    } else {
      result[key] = value;
    }
  }

  result.repos = repos;

  return result;
}
