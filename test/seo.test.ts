import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_CANONICAL, SEARCH_ROBOTS, SITE_DESCRIPTION, SITE_ORIGIN, SITEMAP_URL, websiteJsonLd } from '@/lib/seo';

describe('crawlable homepage only', () => {
  const robots = readFileSync('public/robots.txt', 'utf8');
  const sitemap = readFileSync('public/sitemap.xml', 'utf8');

  it('advertises a sitemap and does not hide /search from crawlers', () => {
    expect(robots).toContain(`Sitemap: ${SITEMAP_URL}`);
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).not.toMatch(/Disallow:\s*\/search/);
  });

  it('lists only the homepage', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([HOME_CANONICAL]);
    expect(sitemap).not.toContain(`${SITE_ORIGIN}/search`);
    expect(sitemap).not.toContain('/api/');
  });

  it('wires those directives onto the routes', () => {
    const home = readFileSync('src/routes/index.tsx', 'utf8');
    const search = readFileSync('src/routes/search.tsx', 'utf8');
    expect(home).toContain('rel: \'canonical\'');
    expect(home).toContain('HOME_CANONICAL');
    expect(search).toContain('SEARCH_ROBOTS');
    expect(search).toContain('HOME_CANONICAL');
  });
});

describe('homepage structured data', () => {
  it('describes the site as a schema.org WebSite with a search action', () => {
    const data = JSON.parse(websiteJsonLd()) as Record<string, any>;
    expect(data['@type']).toBe('WebSite');
    expect(data.url).toBe(HOME_CANONICAL);
    expect(data.description).toBe(SITE_DESCRIPTION);
    expect(data.potentialAction.target.urlTemplate).toBe(`${SITE_ORIGIN}/search?q={search_term_string}`);
  });

  it('cannot close its own script tag', () => {
    expect(websiteJsonLd('</script><b>')).not.toContain('</script>');
  });

  it('keeps the title and description inside search snippet limits', () => {
    const root = readFileSync('src/routes/__root.tsx', 'utf8');
    const title = /const TITLE = '([^']+)'/.exec(root)?.[1] ?? '';
    expect(title.length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(readFileSync('src/routes/index.tsx', 'utf8')).toContain('websiteJsonLd()');
  });
});
