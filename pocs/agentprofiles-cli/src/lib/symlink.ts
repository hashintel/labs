import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Read the target of a symlink.
 * Returns null if the path is not a symlink.
 */
export async function readSymlinkTarget(linkPath: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      return null;
    }
    return await fs.readlink(linkPath);
  } catch {
    return null;
  }
}

/**
 * Check if a path is a symlink.
 */
export async function isSymlink(linkPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(linkPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Create a symlink atomically using the temp + rename pattern.
 * This ensures atomic replacement of an existing symlink.
 *
 * Pattern:
 * 1. Create temp symlink in parent dir
 * 2. Rename temp over target (atomic on POSIX)
 */
export async function atomicSymlink(
  target: string,
  linkPath: string
): Promise<void> {
  const parentDir = path.dirname(linkPath);
  const linkName = path.basename(linkPath);
  const tempLinkName = `.${linkName}-tmp-${Date.now()}`;
  const tempLinkPath = path.join(parentDir, tempLinkName);

  try {
    // Create temp symlink
    await fs.symlink(target, tempLinkPath);

    // Atomically rename over target
    await fs.rename(tempLinkPath, linkPath);
  } catch (err) {
    // Clean up temp symlink if rename failed
    try {
      await fs.unlink(tempLinkPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Move a directory from src to dst.
 * Tries rename() first (fast, same filesystem).
 * Falls back to recursive copy + delete for cross-device moves.
 */
export async function moveDirectory(src: string, dst: string): Promise<void> {
  try {
    // Try fast rename first
    await fs.rename(src, dst);
  } catch (err) {
    // Check if it's a cross-device error
    if (
      err instanceof Error &&
      'code' in err &&
      (err.code === 'EXDEV' || err.code === 'EACCES')
    ) {
      // Fall back to copy + delete
      await copyDirectory(src, dst);
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Recursively copy a directory.
 */
async function copyDirectory(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks as-is
      const target = await fs.readlink(srcPath);
      await fs.symlink(target, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

