/**
 * GitHub API utilities for fetching repository metadata
 */

interface GitHubRepoMetadata {
  description: string | null;
  topics: string[];
  stargazers_count: number;
  language: string | null;
  homepage: string | null;
}

/**
 * Fetch repository metadata from GitHub API
 * Returns null if the fetch fails (non-GitHub host, rate limited, etc.)
 */
export async function fetchGitHubMetadata(
  owner: string,
  repo: string
): Promise<GitHubRepoMetadata | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'clones-cli',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      description?: string;
      topics?: string[];
      stargazers_count?: number;
      language?: string;
      homepage?: string;
    };

    return {
      description: data.description ?? null,
      topics: data.topics ?? [],
      stargazers_count: data.stargazers_count ?? 0,
      language: data.language ?? null,
      homepage: data.homepage ?? null,
    };
  } catch {
    return null;
  }
}
