import pc from 'picocolors';

declare const __DEV__: boolean;
declare const __BUILD_TIME__: string;
declare const __GIT_SHA__: string;
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;
const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
const gitSha = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : '';

// Pre-generated banner (cfonts tiny/candy)
const BANNER =
  '\n\u001b[35m \u001b[39m\u001b[95m█▀▀\u001b[39m\u001b[96m \u001b[39m\u001b[32m█  \u001b[39m\u001b[92m \u001b[39m\u001b[91m█▀█\u001b[39m\u001b[92m \u001b[39m\u001b[95m█▄ █\u001b[39m\u001b[32m \u001b[39m\u001b[32m█▀▀\u001b[39m\u001b[96m \u001b[39m\u001b[31m█▀▀\u001b[39m\n\u001b[31m \u001b[39m\u001b[31m█▄▄\u001b[39m\u001b[36m \u001b[39m\u001b[33m█▄▄\u001b[39m\u001b[31m \u001b[39m\u001b[96m█▄█\u001b[39m\u001b[32m \u001b[39m\u001b[32m█ ▀█\u001b[39m\u001b[95m \u001b[39m\u001b[96m██▄\u001b[39m\u001b[33m \u001b[39m\u001b[94m▄▄█\u001b[39m\n';

export function renderBanner(): void {
  console.log(BANNER);
}

export function renderInfo(pkg: { name: string; version: string; description?: string }): void {
  const devMetaParts: string[] = [];
  if (gitSha) devMetaParts.push(gitSha);
  if (buildTime) devMetaParts.push(`@ ${buildTime}`);
  const devLabel = devMetaParts.length > 0 ? `dev ${devMetaParts.join(' ')}` : 'dev';
  const devTag = isDev ? pc.yellow(` (${devLabel})`) : '';
  const info = `${pc.dim(pkg.name)} ${pc.cyan(`v${pkg.version}`)}${devTag}`;
  const desc = pkg.description ? pc.dim(` — ${pkg.description}`) : '';
  console.log(`${info}${desc}\n`);
}
