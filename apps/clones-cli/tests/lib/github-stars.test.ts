import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchStarredRepos,
  starRepo,
  unstarRepo,
  isRepoStarred,
} from '../../src/lib/github-stars.js';

const mockToken = 'test-token-123';

describe('fetchStarredRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches single page of starred repos', async () => {
    const mockData = [
      {
        starred_at: '2024-01-15T10:30:00Z',
        repo: {
          full_name: 'owner1/repo1',
          owner: { login: 'owner1' },
          name: 'repo1',
          clone_url: 'https://github.com/owner1/repo1.git',
          description: 'Test repo 1',
          topics: ['test', 'demo'],
          language: 'TypeScript',
          homepage: 'https://example.com',
        },
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => mockData,
      headers: new Map([['Link', null]]),
    });

    const repos = await fetchStarredRepos(mockToken);

    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      owner: 'owner1',
      repo: 'repo1',
      cloneUrl: 'https://github.com/owner1/repo1.git',
      description: 'Test repo 1',
      topics: ['test', 'demo'],
      language: 'TypeScript',
      homepage: 'https://example.com',
      starredAt: '2024-01-15T10:30:00Z',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.github.com/user/starred'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          Accept: 'application/vnd.github.star+json',
          'User-Agent': 'clones-cli',
        }),
      })
    );
  });

  it('handles pagination with Link header', async () => {
    const page1 = [
      {
        starred_at: '2024-01-15T10:30:00Z',
        repo: {
          full_name: 'owner1/repo1',
          owner: { login: 'owner1' },
          name: 'repo1',
          clone_url: 'https://github.com/owner1/repo1.git',
          description: null,
          topics: [],
          language: null,
          homepage: null,
        },
      },
    ];

    const page2 = [
      {
        starred_at: '2024-01-14T10:30:00Z',
        repo: {
          full_name: 'owner2/repo2',
          owner: { login: 'owner2' },
          name: 'repo2',
          clone_url: 'https://github.com/owner2/repo2.git',
          description: null,
          topics: [],
          language: null,
          homepage: null,
        },
      },
    ];

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => page1,
        headers: new Map([['Link', '<https://api.github.com/user/starred?page=2>; rel="next"']]),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => page2,
        headers: new Map([['Link', null]]),
      });

    const repos = await fetchStarredRepos(mockToken);

    expect(repos).toHaveLength(2);
    expect(repos[0].repo).toBe('repo1');
    expect(repos[1].repo).toBe('repo2');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles empty response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => [],
      headers: new Map([['Link', null]]),
    });

    const repos = await fetchStarredRepos(mockToken);

    expect(repos).toHaveLength(0);
  });

  it('throws on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: async () => ({}),
      headers: new Map(),
    });

    await expect(fetchStarredRepos(mockToken)).rejects.toThrow('Invalid GitHub token');
  });

  it('throws on 403 rate limit', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 403,
      ok: false,
      json: async () => ({}),
      headers: new Map(),
    });

    await expect(fetchStarredRepos(mockToken)).rejects.toThrow('GitHub API rate limit exceeded');
  });
});

describe('starRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stars a repository successfully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    const result = await starRepo(mockToken, 'owner', 'repo');

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user/starred/owner/repo',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          'User-Agent': 'clones-cli',
        }),
      })
    );
  });

  it('throws on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    await expect(starRepo(mockToken, 'owner', 'repo')).rejects.toThrow('Invalid GitHub token');
  });

  it('throws on 403 rate limit', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 403,
      ok: false,
    });

    await expect(starRepo(mockToken, 'owner', 'repo')).rejects.toThrow(
      'GitHub API rate limit exceeded'
    );
  });
});

describe('unstarRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unstars a repository successfully', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    const result = await unstarRepo(mockToken, 'owner', 'repo');

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user/starred/owner/repo',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          'User-Agent': 'clones-cli',
        }),
      })
    );
  });

  it('throws on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    await expect(unstarRepo(mockToken, 'owner', 'repo')).rejects.toThrow('Invalid GitHub token');
  });

  it('throws on 403 rate limit', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 403,
      ok: false,
    });

    await expect(unstarRepo(mockToken, 'owner', 'repo')).rejects.toThrow(
      'GitHub API rate limit exceeded'
    );
  });
});

describe('isRepoStarred', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when repo is starred', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    const result = await isRepoStarred(mockToken, 'owner', 'repo');

    expect(result).toBe(true);
  });

  it('returns false when repo is not starred', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 404,
      ok: false,
    });

    const result = await isRepoStarred(mockToken, 'owner', 'repo');

    expect(result).toBe(false);
  });

  it('throws on 401 unauthorized', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 401,
      ok: false,
    });

    await expect(isRepoStarred(mockToken, 'owner', 'repo')).rejects.toThrow('Invalid GitHub token');
  });

  it('throws on 403 rate limit', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 403,
      ok: false,
    });

    await expect(isRepoStarred(mockToken, 'owner', 'repo')).rejects.toThrow(
      'GitHub API rate limit exceeded'
    );
  });

  it('sends correct headers', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      status: 204,
      ok: true,
    });

    await isRepoStarred(mockToken, 'owner', 'repo');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user/starred/owner/repo',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
          'User-Agent': 'clones-cli',
        }),
      })
    );
  });
});
