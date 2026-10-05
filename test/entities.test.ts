import { describe, expect, it } from 'vitest';
import { titleKey } from '@/lib/rank';
import { decodeEntities } from '@/lib/search1api';

describe('dash handling', () => {
  it('decodes dash and quote entities in snippets', () => {
    expect(decodeEntities('a &mdash; b &ndash; c &ldquo;d&rdquo;')).toBe('a \u2014 b \u2013 c \u201cd\u201d');
  });

  it('drops a site suffix after an en or em dash from title keys', () => {
    expect(titleKey('Bun is fast \u2014 Reddit')).toBe('bun is fast');
    expect(titleKey('Bun is fast \u2013 Hacker News')).toBe('bun is fast');
  });
});
