import path from 'node:path';

export function isDirenvHookLoaded(env: NodeJS.ProcessEnv) {
  return Boolean(env.DIRENV_DIR || env.DIRENV_FILE || env.DIRENV_WATCHES);
}

export function getDirenvHookHint(shellPath?: string | null) {
  const shellName = shellPath ? path.basename(shellPath) : '';
  switch (shellName) {
    case 'bash':
    case 'zsh':
      return `eval "$(direnv hook ${shellName})"`;
    case 'fish':
      return 'direnv hook fish | source';
    case 'tcsh':
      return 'eval `direnv hook tcsh`';
    case 'elvish':
      return 'eval (direnv hook elvish)';
    default:
      return 'direnv hook <your-shell>';
  }
}
