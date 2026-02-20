import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Read README.md from a cloned repository path.
 * Performs case-insensitive file lookup (README.md, readme.md, Readme.md, etc.)
 * Returns null if no README is found.
 */
export async function readReadmeContent(localPath: string): Promise<string | null> {
  const possibleNames = ['README.md', 'readme.md', 'Readme.md', 'ReadMe.md'];

  for (const name of possibleNames) {
    const filePath = join(localPath, name);
    if (existsSync(filePath)) {
      try {
        return await readFile(filePath, 'utf-8');
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Compute SHA-256 hash of content for incremental indexing.
 * Returns hex-encoded hash string.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Split text into chunks with optional overlap.
 * Attempts to split on paragraph boundaries (double newlines) when possible.
 *
 * @param text - The text to chunk
 * @param chunkSize - Target chunk size in characters (default: 500)
 * @param overlap - Overlap size in characters (default: 100)
 * @returns Array of text chunks
 */
export function chunkText(text: string, chunkSize = 500, overlap = 100): string[] {
  if (!text || text.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentPos = 0;

  while (currentPos < text.length) {
    // Calculate the end position for this chunk
    let endPos = Math.min(currentPos + chunkSize, text.length);

    // If we're not at the end of the text, try to split on paragraph boundary
    if (endPos < text.length) {
      // Look for double newline (paragraph boundary) within a reasonable range
      const searchStart = Math.max(currentPos, endPos - 100);
      const searchEnd = endPos;
      const searchText = text.substring(searchStart, searchEnd);
      const paragraphBreak = searchText.lastIndexOf('\n\n');

      if (paragraphBreak !== -1) {
        endPos = searchStart + paragraphBreak + 2; // Include the double newline
      } else {
        // Fall back to splitting on single newline
        const lineBreak = searchText.lastIndexOf('\n');
        if (lineBreak !== -1) {
          endPos = searchStart + lineBreak + 1;
        }
      }
    }

    // Extract and trim the chunk
    const chunk = text.substring(currentPos, endPos).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Move to next position with overlap
    currentPos = endPos - overlap;

    // Prevent infinite loop if chunk is very small
    if (currentPos <= chunks.length * chunkSize - chunkSize) {
      currentPos = Math.max(currentPos, endPos);
    }
  }

  return chunks;
}
