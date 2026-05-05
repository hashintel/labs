import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'ReadMe.md'];
const HIGH_SIGNAL_FILES = [
  'package.json',
  'tsconfig.json',
  'deno.json',
  'deno.jsonc',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Makefile',
  'justfile',
];

export interface IndexableDocument {
  source: string;
  content: string;
}

async function readTextFileIfExists(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read README.md from a cloned repository path.
 * Performs case-insensitive file lookup (README.md, readme.md, Readme.md, etc.)
 * Returns null if no README is found.
 */
export async function readReadmeContent(localPath: string): Promise<string | null> {
  for (const name of README_CANDIDATES) {
    const content = await readTextFileIfExists(join(localPath, name));
    if (content !== null) {
      return content;
    }
  }

  return null;
}

/**
 * Read indexable documents from a repository root.
 * Includes README (case-insensitive) and a small set of high-signal root files.
 */
export async function readIndexableDocuments(localPath: string): Promise<IndexableDocument[]> {
  const documents: IndexableDocument[] = [];
  const seenSources = new Set<string>();

  for (const name of README_CANDIDATES) {
    const content = await readTextFileIfExists(join(localPath, name));
    if (content !== null) {
      documents.push({ source: name, content });
      seenSources.add(name.toLowerCase());
      break;
    }
  }

  for (const name of HIGH_SIGNAL_FILES) {
    if (seenSources.has(name.toLowerCase())) {
      continue;
    }
    const content = await readTextFileIfExists(join(localPath, name));
    if (content !== null) {
      documents.push({ source: name, content });
    }
  }

  return documents;
}

/**
 * Compute SHA-256 hash of content for incremental indexing.
 * Returns hex-encoded hash string.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Build a compact profile text block for a repository.
 * This creates a dedicated metadata chunk so lexical search can match even
 * when README quality is weak.
 */
export function buildRepoProfileText(input: {
  host: string;
  owner: string;
  repo: string;
  description?: string;
  tags?: string[];
}): string {
  const lines = [`${input.owner}/${input.repo}`, `${input.host}/${input.owner}/${input.repo}`];

  if (input.description) {
    lines.push(input.description);
  }

  if (input.tags && input.tags.length > 0) {
    lines.push(`tags: ${input.tags.join(' ')}`);
  }

  return lines.join('\n');
}

/**
 * Compute a deterministic hash for all indexed inputs for a repository.
 */
export function hashIndexInputs(documents: IndexableDocument[], profileText: string): string {
  const hash = createHash('sha256');
  const sortedDocs = [...documents].sort((a, b) => a.source.localeCompare(b.source));
  for (const doc of sortedDocs) {
    hash.update(doc.source);
    hash.update('\n');
    hash.update(doc.content);
    hash.update('\n');
  }
  hash.update('__profile__');
  hash.update('\n');
  hash.update(profileText);
  return hash.digest('hex');
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
