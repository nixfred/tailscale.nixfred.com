/**
 * Canonical path normalization.
 *
 * WHY THIS EXISTS. astro.config.mjs sets `build.format: 'file'`, so every
 * page is emitted as `<name>.html` and `Astro.url.pathname` carries that
 * extension at build time. Every internal link a factory site writes uses
 * the EXTENSIONLESS form. Cloudflare Pages serves both.
 *
 * Before this file existed, every factory site declared
 * `/about.html` as its canonical and og:url while linking exclusively to
 * `/about`. Two URLs for one page, with the canonical pointing at the one
 * nothing links to. Found on tools.nixfred.com 2026-07-27 and confirmed
 * live on sun.nixfred.com the same week.
 *
 * Normalizing here rather than at each call site means canonical, og:url,
 * and anything else that names the page cannot drift apart.
 */

/**
 * Strip the `.html` Astro adds under `build.format: 'file'`, and collapse
 * an index page to its directory.
 *
 * Examples:
 *   /index.html   -> /
 *   /about.html   -> /about
 *   /a/b.html     -> /a/b
 *   /             -> /            (already canonical)
 */
export function canonicalPath(pathname: string): string {
  let p = pathname;

  if (p === '/index.html') return '/';
  if (p.endsWith('/index.html')) {
    return p.slice(0, -'index.html'.length);
  }

  if (p.endsWith('.html')) {
    p = p.slice(0, -'.html'.length);
  }

  return p === '' ? '/' : p;
}

/** The absolute canonical URL for a page, as a string. */
export function canonicalUrl(pathname: string, site: URL | undefined): string {
  return new URL(canonicalPath(pathname), site).toString();
}
