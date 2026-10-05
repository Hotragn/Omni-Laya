/** Deployment origin. Replace this and the copies in `public/robots.txt` and `public/sitemap.xml` with your domain. */
export const SITE_ORIGIN = 'https://omnilaya-search.workers.dev';
export const HOME_CANONICAL = `${SITE_ORIGIN}/`;
export const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`;
// Social networks cache the card by URL; bump the version whenever the image changes.
export const SHARE_IMAGE = `${SITE_ORIGIN}/og-home.png?v=2`;

/** Result URLs are queries, not documents. Allow crawling so the directive is visible. */
export const SEARCH_ROBOTS = 'noindex, follow';

export const SITE_DESCRIPTION =
  'Open-source web search where Laya, a small decision model, picks the sources and time range and ranks every result. Links only, no generated answers.';

/** schema.org WebSite for the homepage: the site name search engines show, and how to search it. */
export function websiteJsonLd(description = SITE_DESCRIPTION): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'OmniLaya Search',
    alternateName: 'OmniLaya',
    url: HOME_CANONICAL,
    description,
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  }).replace(/</g, '\\u003c');
}
