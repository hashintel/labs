/**
 * GitHub Stars API client for authenticated operations
 * Handles listing, starring, and checking starred repositories
 */

export interface StarredRepo {
  owner: string;
  repo: string;
  cloneUrl: string;
  description: string | null;
  topics: string[];
  language: string | null;
  homepage: string | null;
  starredAt: string; // ISO 8601
}

interface GitHubStarResponse {
  starred_at: string;
  repo: {
    full_name: string;
    owner: { login: string };
    name: string;
    clone_url: string;
    description: string | null;
    topics: string[];
    language: string | null;
    homepage: string | null;
  };
}

interface LinkHeader {
  next?: string;
  prev?: string;
  first?: string;
  last?: string;
}

function parseLinkHeader(linkHeader: string | null): LinkHeader {
  const links: LinkHeader = {};
  if (!linkHeader) return links;

  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      const [, url, rel] = match;
      links[rel as keyof LinkHeader] = url;
    }
  }
  return links;
}

/**
 * Fetch all starred repositories for the authenticated user
 * Uses pagination to retrieve all results
 */
export async function fetchStarredRepos(token: string): Promise<StarredRepo[]> {
  const repos: StarredRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = new URL('https://api.github.com/user/starred');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.star+json',
        'User-Agent': 'clones-cli',
      },
    });

    if (response.status === 401) {
      throw new Error('Invalid GitHub token');
    }
    if (response.status === 403) {
      throw new Error('GitHub API rate limit exceeded');
    }
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as GitHubStarResponse[];

    if (data.length === 0) {
      break;
    }

    for (const item of data) {
      repos.push({
        owner: item.repo.owner.login,
        repo: item.repo.name,
        cloneUrl: item.repo.clone_url,
        description: item.repo.description ?? null,
        topics: item.repo.topics ?? [],
        language: item.repo.language ?? null,
        homepage: item.repo.homepage ?? null,
        starredAt: item.starred_at,
      });
    }

    // Check for next page in Link header
    const linkHeader = response.headers.get('Link');
    const links = parseLinkHeader(linkHeader);
    if (!links.next) {
      break;
    }

    page += 1;
  }

  return repos;
}

/**
 * Star a repository for the authenticated user
 */
export async function starRepo(token: string, owner: string, repo: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'clones-cli',
    },
  });

  if (response.status === 401) {
    throw new Error('Invalid GitHub token');
  }
  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded');
  }
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.status === 204;
}

/**
 * Check if a repository is starred by the authenticated user
 */
export async function isRepoStarred(token: string, owner: string, repo: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'clones-cli',
    },
  });

  if (response.status === 401) {
    throw new Error('Invalid GitHub token');
  }
  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded');
  }
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.status === 204;
}
