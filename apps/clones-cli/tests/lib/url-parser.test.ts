import { describe, it, expect } from 'vitest';
import {
  parseGitUrl,
  generateRepoId,
  isValidGitUrl,
  normalizeGitUrl,
} from '../../src/lib/url-parser.js';

describe('parseGitUrl', () => {
  describe('SSH URLs', () => {
    it('parses standard SSH URL with .git suffix', () => {
      const result = parseGitUrl('git@github.com:owner/repo.git');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'git@github.com:owner/repo.git',
      });
    });

    it('parses SSH URL without .git suffix', () => {
      const result = parseGitUrl('git@github.com:owner/repo');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'git@github.com:owner/repo.git',
      });
    });

    it('parses GitLab SSH URL', () => {
      const result = parseGitUrl('git@gitlab.com:company/project.git');

      expect(result).toEqual({
        host: 'gitlab.com',
        owner: 'company',
        repo: 'project',
        cloneUrl: 'git@gitlab.com:company/project.git',
      });
    });

    it('parses custom host SSH URL', () => {
      const result = parseGitUrl('git@git.company.com:team/app.git');

      expect(result).toEqual({
        host: 'git.company.com',
        owner: 'team',
        repo: 'app',
        cloneUrl: 'git@git.company.com:team/app.git',
      });
    });
  });

  describe('HTTPS URLs', () => {
    it('parses standard HTTPS URL with .git suffix', () => {
      const result = parseGitUrl('https://github.com/owner/repo.git');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('parses HTTPS URL without .git suffix', () => {
      const result = parseGitUrl('https://github.com/owner/repo');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('parses HTTP URL', () => {
      const result = parseGitUrl('http://github.com/owner/repo.git');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'http://github.com/owner/repo.git',
      });
    });

    it('parses Bitbucket HTTPS URL', () => {
      const result = parseGitUrl('https://bitbucket.org/team/project.git');

      expect(result).toEqual({
        host: 'bitbucket.org',
        owner: 'team',
        repo: 'project',
        cloneUrl: 'https://bitbucket.org/team/project.git',
      });
    });
  });

  describe('edge cases', () => {
    it('trims whitespace', () => {
      const result = parseGitUrl('  https://github.com/owner/repo.git  ');

      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
    });

    it('throws on invalid URL format', () => {
      expect(() => parseGitUrl('not-a-url')).toThrow('Invalid Git URL format');
    });

    it('throws on bare domain', () => {
      expect(() => parseGitUrl('https://github.com')).toThrow('Invalid Git URL format');
    });

    it('throws on URL with only owner', () => {
      expect(() => parseGitUrl('https://github.com/owner')).toThrow('Invalid Git URL format');
    });

    it('handles URLs with query params and hash anchors', () => {
      const result = parseGitUrl('https://github.com/owner/repo?utm_source=test#readme');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('handles URLs with extra path segments', () => {
      const result = parseGitUrl('https://github.com/owner/repo/tree/main/src/lib');

      expect(result).toEqual({
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        cloneUrl: 'https://github.com/owner/repo.git',
      });
    });

    it('rejects SSH URLs with extra path segments', () => {
      expect(() => parseGitUrl('git@github.com:owner/repo/tree/main')).toThrow(
        'Unsupported SSH URL format'
      );
    });

    it('rejects subgroup-style HTTPS URLs', () => {
      expect(() => parseGitUrl('https://gitlab.com/group/subgroup/repo')).toThrow(
        'Subgroup paths are not supported yet'
      );
    });
  });
});

describe('generateRepoId', () => {
  it('generates ID from parsed URL', () => {
    const parsed = parseGitUrl('https://github.com/owner/repo.git');
    const id = generateRepoId(parsed);

    expect(id).toBe('github.com:owner/repo');
  });

  it('includes host in ID for uniqueness', () => {
    const github = parseGitUrl('https://github.com/owner/repo.git');
    const gitlab = parseGitUrl('https://gitlab.com/owner/repo.git');

    expect(generateRepoId(github)).not.toBe(generateRepoId(gitlab));
  });
});

describe('isValidGitUrl', () => {
  it('returns true for valid SSH URL', () => {
    expect(isValidGitUrl('git@github.com:owner/repo.git')).toBe(true);
  });

  it('returns true for valid HTTPS URL', () => {
    expect(isValidGitUrl('https://github.com/owner/repo.git')).toBe(true);
  });

  it('returns false for invalid URL', () => {
    expect(isValidGitUrl('not-a-url')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isValidGitUrl('')).toBe(false);
  });
});

describe('normalizeGitUrl', () => {
  it('strips /tree/branch from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/tree/main')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /tree/branch/path from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/tree/main/src/lib')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /blob/branch/file from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/blob/main/README.md')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /commit/hash from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/commit/abc123')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /pull/number from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/pull/123')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /issues from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/issues')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /releases from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/releases')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('strips /actions from URL', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo/actions')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('leaves clean URLs unchanged', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });

  it('leaves URLs with .git unchanged', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo.git'
    );
  });

  it('strips query params and hashes', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo?foo=bar#readme')).toBe(
      'https://github.com/owner/repo'
    );
  });

  it('keeps .git when extra segments exist', () => {
    expect(normalizeGitUrl('https://github.com/owner/repo.git/tree/main')).toBe(
      'https://github.com/owner/repo.git'
    );
  });
});

describe('parseGitUrl with web UI URLs', () => {
  it('parses GitHub tree URL', () => {
    const result = parseGitUrl('https://github.com/SBoudrias/Inquirer.js/tree/main');

    expect(result).toEqual({
      host: 'github.com',
      owner: 'sboudrias',
      repo: 'inquirer.js',
      cloneUrl: 'https://github.com/sboudrias/inquirer.js.git',
    });
  });

  it('parses GitHub blob URL', () => {
    const result = parseGitUrl('https://github.com/owner/repo/blob/main/package.json');

    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
    });
  });

  it('parses GitHub pull request URL', () => {
    const result = parseGitUrl('https://github.com/owner/repo/pull/42');

    expect(result).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
    });
  });
});
