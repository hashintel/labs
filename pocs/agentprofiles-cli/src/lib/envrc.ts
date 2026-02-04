const BOOTSTRAP_BEGIN = '### agentprofiles:begin';
const BOOTSTRAP_END = '### agentprofiles:end';
const HEADER = '# tool-generated; do not edit';

export const MANAGED_ENVRC_FILENAME = '.envrc.agentprofiles';
export const LEGACY_MANAGED_ENVRC_FILENAME = '.envrc.agent';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureEndsWithNewline(content: string) {
  return content.endsWith('\n') ? content : `${content}\n`;
}

export function ensureBootstrapBlock(content: string) {
  const block = `${BOOTSTRAP_BEGIN}
	watch_file ${MANAGED_ENVRC_FILENAME}
	source_env_if_exists ${MANAGED_ENVRC_FILENAME}
${BOOTSTRAP_END}`;
  const blockRegex = new RegExp(
    `${escapeRegExp(BOOTSTRAP_BEGIN)}[\\s\\S]*?${escapeRegExp(BOOTSTRAP_END)}`
  );

  if (blockRegex.test(content)) {
    return ensureEndsWithNewline(content.replace(blockRegex, block));
  }

  const prefix = content.length && !content.endsWith('\n') ? `${content}\n` : content;
  return ensureEndsWithNewline(`${prefix}${block}`);
}

function normalizeHeader(content: string) {
  const trimmedStart = content.trimStart();
  const next = trimmedStart.startsWith(HEADER)
    ? trimmedStart
    : `${HEADER}\n${trimmedStart ? `\n${trimmedStart}` : ''}`;
  return ensureEndsWithNewline(next);
}

export function updateAgentBlock(
  content: string,
  agent: string,
  envVar: string,
  profilePath: string
) {
  const begin = `### agentprofiles:begin ${agent}`;
  const end = `### agentprofiles:end ${agent}`;
  const block = `${begin}
export ${envVar}="${profilePath}"
${end}`;
  const blockRegex = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
  let next = content;

  if (blockRegex.test(next)) {
    next = next.replace(blockRegex, block);
  } else {
    const prefix = next.length && !next.endsWith('\n') ? `${next}\n` : next;
    next = `${prefix}${block}\n`;
  }

  return normalizeHeader(next);
}

export function removeAgentBlock(content: string, agent: string) {
  const begin = `### agentprofiles:begin ${agent}`;
  const end = `### agentprofiles:end ${agent}`;
  const blockRegex = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'g');
  let next = content.replace(blockRegex, '');
  next = next.replace(/\n{3,}/g, '\n\n').trim();
  return normalizeHeader(next);
}

export function getActiveProfile(content: string, agent: string): string | null {
  const begin = `### agentprofiles:begin ${agent}`;
  const end = `### agentprofiles:end ${agent}`;
  const blockRegex = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
  const match = content.match(blockRegex);
  if (!match) return null;

  const exportMatch = match[0].match(/export\s+\w+="([^"]+)"/);
  if (!exportMatch || !exportMatch[1]) return null;

  const profilePath = exportMatch[1];
  const parts = profilePath.replace('$HOME', '').split('/');
  return parts[parts.length - 1] ?? null;
}

export function hasAnyAgentBlocks(content: string): boolean {
  const agentBlockRegex = /### agentprofiles:begin \w+[\s\S]*?### agentprofiles:end \w+/;
  return agentBlockRegex.test(content);
}

export function removeBootstrapBlock(content: string): string {
  const blockRegex = new RegExp(
    `${escapeRegExp(BOOTSTRAP_BEGIN)}[\\s\\S]*?${escapeRegExp(BOOTSTRAP_END)}\\n?`
  );
  let next = content.replace(blockRegex, '');
  next = next.replace(/\n{3,}/g, '\n\n').trim();
  return next;
}

export function isEffectivelyEmpty(content: string): boolean {
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    })
    .join('');
  return stripped.length === 0;
}
