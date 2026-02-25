import { describe, it, expect } from 'vitest';
import { createRepoFilter, type FilterFn } from '../../src/lib/filters.js';
import type { Option } from '@clack/prompts';
import type { RegistryEntry } from '../../src/types/index.js';

// Helper to create mock registry entry
function mockEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'github.com:owner/repo',
    host: 'github.com',
    owner: 'owner',
    repo: 'repo',
    cloneUrl: 'https://github.com/owner/repo.git',
    defaultRemoteName: 'origin',
    updateStrategy: 'ff-only',
    submodules: 'none',
    lfs: 'auto',
    managed: true,
    ...overrides,
  };
}

// Helper to create option from entry
function toOption(entry: RegistryEntry): Option<RegistryEntry> {
  return {
    value: entry,
    label: `${entry.owner}/${entry.repo}`,
  };
}

describe('createRepoFilter', () => {
  const filter = createRepoFilter();

  describe('empty search', () => {
    it('returns true for empty search text', () => {
      const option = toOption(mockEntry());
      expect(filter('', option)).toBe(true);
    });
  });

  describe('matching by owner/repo name', () => {
    it('matches owner name', () => {
      const option = toOption(mockEntry({ owner: 'anthropic', repo: 'sdk' }));
      expect(filter('anthropic', option)).toBe(true);
      expect(filter('ant', option)).toBe(true);
    });

    it('matches repo name', () => {
      const option = toOption(mockEntry({ owner: 'anthropic', repo: 'claude-sdk' }));
      expect(filter('claude', option)).toBe(true);
      expect(filter('sdk', option)).toBe(true);
    });

    it('is case insensitive', () => {
      const option = toOption(mockEntry({ owner: 'Anthropic', repo: 'Claude-SDK' }));
      expect(filter('ANTHROPIC', option)).toBe(true);
      expect(filter('claude', option)).toBe(true);
    });

    it('does not match unrelated terms', () => {
      const option = toOption(mockEntry({ owner: 'foo', repo: 'bar' }));
      expect(filter('baz', option)).toBe(false);
    });
  });

  describe('matching by tags', () => {
    it('matches tag content', () => {
      const option = toOption(mockEntry({ tags: ['cli', 'typescript', 'ai'] }));
      expect(filter('cli', option)).toBe(true);
      expect(filter('typescript', option)).toBe(true);
      expect(filter('ai', option)).toBe(true);
    });

    it('matches partial tag', () => {
      const option = toOption(mockEntry({ tags: ['typescript'] }));
      expect(filter('type', option)).toBe(true);
      expect(filter('script', option)).toBe(true);
    });

    it('handles repos without tags', () => {
      const option = toOption(mockEntry({ tags: undefined }));
      expect(filter('tag', option)).toBe(false);
    });

    it('handles empty tags array', () => {
      const option = toOption(mockEntry({ tags: [] }));
      expect(filter('tag', option)).toBe(false);
    });
  });

  describe('matching by description', () => {
    it('matches description content', () => {
      const option = toOption(
        mockEntry({ description: 'A powerful CLI for managing repositories' })
      );
      expect(filter('powerful', option)).toBe(true);
      expect(filter('cli', option)).toBe(true);
      expect(filter('managing', option)).toBe(true);
    });

    it('handles repos without description', () => {
      const option = toOption(mockEntry({ description: undefined }));
      expect(filter('description', option)).toBe(false);
    });
  });

  describe('combined matching', () => {
    it('matches when term appears in name but not tags/description', () => {
      const option = toOption(
        mockEntry({
          owner: 'anthropic',
          repo: 'sdk',
          tags: ['python'],
          description: 'Python library',
        })
      );
      expect(filter('anthropic', option)).toBe(true);
    });

    it('matches when term appears in tags but not name/description', () => {
      const option = toOption(
        mockEntry({
          owner: 'foo',
          repo: 'bar',
          tags: ['typescript'],
          description: 'A library',
        })
      );
      expect(filter('typescript', option)).toBe(true);
    });

    it('matches when term appears in description but not name/tags', () => {
      const option = toOption(
        mockEntry({
          owner: 'foo',
          repo: 'bar',
          tags: ['cli'],
          description: 'Machine learning utilities',
        })
      );
      expect(filter('machine', option)).toBe(true);
    });
  });
});

describe('FilterFn type', () => {
  it('allows creating custom typed filters', () => {
    // This is primarily a compile-time check
    const customFilter: FilterFn<RegistryEntry> = (searchText, option) => {
      return option.value.owner.includes(searchText);
    };

    const option = toOption(mockEntry({ owner: 'test' }));
    expect(customFilter('test', option)).toBe(true);
    expect(customFilter('other', option)).toBe(false);
  });
});
