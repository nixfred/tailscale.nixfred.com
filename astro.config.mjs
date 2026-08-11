// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkCallouts from './src/lib/remark-callouts.mjs';

// tailscale.nixfred.com. Static output, Cloudflare Pages, no adapters.
export default defineConfig({
  site: 'https://tailscale.nixfred.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  integrations: [
    sitemap({
      // build.format 'file' makes Astro emit /learn/foo.html, but every
      // canonical on the site is extensionless (see lib/canonicalPath.ts).
      // Strip the extension here too, or the sitemap advertises a second
      // URL for every page and the canonical gate's promise is broken.
      serialize(item) {
        item.url = item.url.replace(/\.html$/, '').replace(/\/index$/, '/');
        return item;
      },
    }),
  ],
  markdown: {
    remarkPlugins: [remarkCallouts],
    shikiConfig: {
      theme: 'github-dark-default',
    },
  },
});
