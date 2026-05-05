/**
 * Shared UI utilities for formatting and display
 */

/**
 * Convert an absolute path to a user-friendly path with ~ for home directory
 */
export function toUserPath(absolutePath: string): string {
  const home = process.env.HOME;
  if (!home) return absolutePath;

  // Exact match (path IS the home directory)
  if (absolutePath === home) {
    return '~';
  }

  // Path under home directory (must have / after home path)
  if (absolutePath.startsWith(home + '/')) {
    return '~' + absolutePath.slice(home.length);
  }

  return absolutePath;
}

/**
 * Format an ISO timestamp as a human-readable relative time
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format an ISO timestamp as a full date
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Copy text to the system clipboard (cross-platform)
 * Uses stdin to avoid shell escaping issues
 */
export async function copyToClipboard(text: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const platform = process.platform;

  return new Promise((resolve, reject) => {
    let cmd: string;
    let args: string[];

    if (platform === 'darwin') {
      cmd = 'pbcopy';
      args = [];
    } else if (platform === 'linux') {
      cmd = 'xclip';
      args = ['-selection', 'clipboard'];
    } else if (platform === 'win32') {
      cmd = 'clip';
      args = [];
    } else {
      reject(new Error(`Unsupported platform: ${platform}`));
      return;
    }

    const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });

    proc.on('error', (err) => {
      if (platform === 'linux') {
        const fallback = spawn('xsel', ['--clipboard', '--input'], {
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        fallback.stdin.write(text);
        fallback.stdin.end();
        fallback.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Could not copy to clipboard'));
        });
        fallback.on('error', () => reject(new Error('Could not copy to clipboard')));
      } else {
        reject(new Error(`Could not copy to clipboard: ${err.message}`));
      }
    });

    proc.stdin.write(text);
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Could not copy to clipboard'));
    });
  });
}
