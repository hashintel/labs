const SLUG_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateProfileName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Profile name is required.';
  if (trimmed !== name) return 'Profile name must not include surrounding whitespace.';
  const slug = slugify(name);
  if (slug.length === 0) return 'Profile name must contain at least one letter or number.';
  if (slug.includes('..')) return 'Profile name must not include "..".';
  return null;
}

export function validateSlug(slug: string): string | null {
  if (slug.length === 0) return 'Slug is required.';
  if (!SLUG_REGEX.test(slug)) {
    return 'Slug must be lowercase letters, numbers, ".", "-", "_".';
  }
  if (slug.includes('..')) return 'Slug must not include "..".';
  return null;
}
