import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readRegistry = vi.fn();
const getGitHubConfig = vi.fn();
const fetchStarredRepos = vi.fn();

const prompts = vi.hoisted(() => ({
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  intro: prompts.intro,
  outro: prompts.outro,
  spinner: prompts.spinner,
  log: prompts.log,
}));

vi.mock('../../src/lib/registry.js', () => ({
  readRegistry,
}));

vi.mock('../../src/lib/config.js', () => ({
  getGitHubConfig,
}));

vi.mock('../../src/lib/github-stars.js', () => ({
  fetchStarredRepos,
}));

const { default: starsCommand } = await import('../../src/commands/stars.js');

describe('clones stars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows error when not authenticated', async () => {
    getGitHubConfig.mockReturnValue({ token: undefined, syncStars: false });

    await starsCommand.run?.({ args: {} } as any);

    expect(prompts.log.error).toHaveBeenCalledWith('Not authenticated with GitHub');
    expect(prompts.log.info).toHaveBeenCalledWith("Run 'clones auth login' to authenticate");
    expect(fetchStarredRepos).not.toHaveBeenCalled();
  });

  it('shows correct stats when authenticated', async () => {
    getGitHubConfig.mockReturnValue({ token: 'test-token', syncStars: false });

    const starredRepos = [
      {
        owner: 'colinhacks',
        repo: 'zod',
        cloneUrl: 'https://github.com/colinhacks/zod.git',
        description: 'TypeScript-first schema validation',
        topics: [],
        language: 'TypeScript',
        homepage: null,
        starredAt: '2024-01-01T00:00:00Z',
      },
      {
        owner: 'vercel',
        repo: 'next.js',
        cloneUrl: 'https://github.com/vercel/next.js.git',
        description: 'The React Framework',
        topics: [],
        language: 'TypeScript',
        homepage: null,
        starredAt: '2024-01-02T00:00:00Z',
      },
    ];

    const registry = {
      version: '1.0.0' as const,
      repos: [
        {
          id: 'github.com:colinhacks/zod',
          host: 'github.com',
          owner: 'colinhacks',
          repo: 'zod',
          cloneUrl: 'https://github.com/colinhacks/zod.git',
          defaultRemoteName: 'origin',
          updateStrategy: 'hard-reset' as const,
          submodules: 'none' as const,
          lfs: 'auto' as const,
          managed: true,
        },
      ],
      tombstones: [],
    };

    fetchStarredRepos.mockResolvedValue(starredRepos);
    readRegistry.mockResolvedValue(registry);

    await starsCommand.run?.({ args: {} } as any);

    expect(prompts.log.info).toHaveBeenCalledWith('GitHub stars: 2');
    expect(prompts.log.info).toHaveBeenCalledWith('Registry repos: 1 (1 from GitHub)');
    expect(prompts.log.warn).toHaveBeenCalledWith('1 starred repos not in registry:');
    expect(prompts.log.info).toHaveBeenCalledWith('  ★ vercel/next.js');
  });

  it('shows success when all starred repos are in registry', async () => {
    getGitHubConfig.mockReturnValue({ token: 'test-token', syncStars: false });

    const starredRepos = [
      {
        owner: 'colinhacks',
        repo: 'zod',
        cloneUrl: 'https://github.com/colinhacks/zod.git',
        description: null,
        topics: [],
        language: null,
        homepage: null,
        starredAt: '2024-01-01T00:00:00Z',
      },
    ];

    const registry = {
      version: '1.0.0' as const,
      repos: [
        {
          id: 'github.com:colinhacks/zod',
          host: 'github.com',
          owner: 'colinhacks',
          repo: 'zod',
          cloneUrl: 'https://github.com/colinhacks/zod.git',
          defaultRemoteName: 'origin',
          updateStrategy: 'hard-reset' as const,
          submodules: 'none' as const,
          lfs: 'auto' as const,
          managed: true,
        },
      ],
      tombstones: [],
    };

    fetchStarredRepos.mockResolvedValue(starredRepos);
    readRegistry.mockResolvedValue(registry);

    await starsCommand.run?.({ args: {} } as any);

    expect(prompts.log.success).toHaveBeenCalledWith('All starred repos are in registry');
  });

  it('handles API errors gracefully', async () => {
    getGitHubConfig.mockReturnValue({ token: 'invalid-token', syncStars: false });
    fetchStarredRepos.mockRejectedValue(new Error('Invalid GitHub token'));

    await starsCommand.run?.({ args: {} } as any);

    expect(prompts.log.error).toHaveBeenCalledWith('GitHub token is invalid or expired');
    expect(prompts.log.info).toHaveBeenCalledWith("Run 'clones auth login' to re-authenticate");
  });
});
